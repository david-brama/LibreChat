import { Context } from 'hono';
import { getAuth } from '@hono/oidc-auth';
import { streamSSE } from 'hono/streaming';
import { ConversationRepository } from '../../db/repositories/conversation';
import { MessageRepository } from '../../db/repositories/message';
import { FileRepository } from '../../db/repositories/fileRepository';
import { R2ImageEncoder } from '../../services/files/r2ImageEncoder';
import { OpenAIStreamingService } from '../../services/OpenAIStreamingService';
import { OpenAITitleService } from '../../services/OpenAITitleService';
import { SseService, SseCompletionResult } from '../../services/SseService';
import { AskRequest, CreateConversationDTO, CreateMessageDTO } from '../../types';
import { ModelRepository } from '../../db/repositories/model';

// Constants for parent message ID handling (matching LibreChat)
const NO_PARENT = '00000000-0000-0000-0000-000000000000';

/**
 * Handler for POST /api/ask/openai
 * Processes chat completion requests with OpenAI's GPT model using the shared streaming service
 * Returns streaming Server-Sent Events (SSE) responses compatible with LibreChat
 * Includes automatic title generation for new conversations and image support for vision models
 */
export async function askOpenAI(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Check if OpenAI API key is available
    if (!c.env.OPENAI_API_KEY) {
      console.error('[askOpenAI] OPENAI_API_KEY not configured');
      return c.json({ error: 'OpenAI API key not configured' }, 500);
    }

    // Parse request body
    const requestData: AskRequest = await c.req.json();
    const {
      text,
      conversationId: requestConversationId,
      parentMessageId,
      messageId,
      endpoint,
      model,
      spec,
      files,
    } = requestData;

    // Initialize model repository to resolve spec to model
    const modelRepository = new ModelRepository(c.env.DB);

    // Resolve model from spec or fall back to model parameter
    let resolvedModel = model;
    let modelConfig = null;

    if (spec) {
      // Find the model configuration by spec
      modelConfig = await modelRepository.findBySpec(spec);
      if (modelConfig) {
        resolvedModel = modelConfig.modelId;
        console.log('[askOpenAI] Resolved spec to model:', {
          spec,
          resolvedModel,
          modelLabel: modelConfig.label,
        });
      } else {
        console.warn('[askOpenAI] Spec not found, falling back to model parameter:', {
          spec,
          fallbackModel: model,
        });
      }
    }

    if (!resolvedModel) {
      return c.json({ error: 'No model specified (spec or model parameter required)' }, 400);
    }

    console.log('[askOpenAI] Processing request:', {
      userId: oidcUser.sub,
      conversationId: requestConversationId,
      messageLength: text.length,
      spec,
      model: resolvedModel,
      hasFiles: !!files?.length,
      fileCount: files?.length || 0,
      fileIds: files?.map((f) => f.file_id) || [],
    });

    // Initialize repositories
    const conversationRepository = new ConversationRepository(c.env.DB);
    const messageRepository = new MessageRepository(c.env.DB);
    const fileRepository = new FileRepository(c.env.DB);

    console.log('[askOpenAI] Repositories initialized');

    // Initialize image encoder for file processing
    const r2ImageEncoder = new R2ImageEncoder(c.env.R2_BUCKET, fileRepository);

    console.log('[askOpenAI] R2ImageEncoder initialized');

    // Process files if present
    let imageContent: any[] = [];
    let processedFiles: any[] = [];

    if (files && files.length > 0) {
      console.log(`[askOpenAI] Starting file processing for ${files.length} files`);
      const fileIds = files.map((f) => f.file_id);

      console.log('[askOpenAI] Calling r2ImageEncoder.encodeAndFormat with:', {
        fileIds,
        userId: oidcUser.sub,
        endpoint: 'openAI',
      });

      try {
        const fileProcessingResult = await r2ImageEncoder.encodeAndFormat(
          fileIds,
          oidcUser.sub,
          'openAI', // endpoint for OpenAI formatting
        );

        console.log(`[askOpenAI] File processing completed successfully:`, {
          hasImageUrls: fileProcessingResult.image_urls.length > 0,
          imageUrlsCount: fileProcessingResult.image_urls.length,
          hasText: !!fileProcessingResult.text,
          textLength: fileProcessingResult.text?.length || 0,
          filesCount: fileProcessingResult.files.length,
        });

        // Log detailed structure of each image URL
        fileProcessingResult.image_urls.forEach((img, idx) => {
          console.log(`[askOpenAI] Image ${idx} structure:`, {
            type: img.type,
            hasImageUrl: !!(img as any).image_url,
            imageUrlKeys: (img as any).image_url ? Object.keys((img as any).image_url) : null,
            imageUrlDetail: (img as any).image_url?.detail,
            imageUrlLength: (img as any).image_url?.url ? (img as any).image_url.url.length : 0,
            imageUrlPrefix: (img as any).image_url?.url
              ? (img as any).image_url.url.substring(0, 50) + '...'
              : null,
          });
        });

        imageContent = fileProcessingResult.image_urls;
        processedFiles = fileProcessingResult.files;

        // Log any text content from files (documents)
        if (fileProcessingResult.text) {
          console.log('[askOpenAI] Text content extracted from files:', {
            textLength: fileProcessingResult.text.length,
            textPreview: fileProcessingResult.text.substring(0, 200) + '...',
          });
        }
      } catch (error) {
        console.error('[askOpenAI] Error during file processing:', error);
        // Continue without images rather than failing
        imageContent = [];
        processedFiles = [];
      }
    } else {
      console.log('[askOpenAI] No files to process');
    }

    // Handle conversation creation/retrieval
    let conversationId = requestConversationId;
    let conversationPromise: Promise<any>;
    let isNewConversation = false;

    if (!conversationId || conversationId === 'null') {
      // Generate new conversation ID
      conversationId = crypto.randomUUID();
      isNewConversation = true;

      const createConvoData: CreateConversationDTO = {
        conversationId,
        userId: oidcUser.sub,
        title: 'New Chat',
        endpoint,
        model: resolvedModel,
      };

      conversationPromise = conversationRepository.create(createConvoData);
      console.log('[askOpenAI] Creating new conversation:', conversationId);
    } else {
      conversationPromise = conversationRepository.findByIdAndUser(conversationId, oidcUser.sub);
    }

    // Format user message content properly for OpenAI Vision API
    // For OpenAI, when images are present, content must be an array with text + image objects
    let userMessageContent: any;
    if (imageContent.length > 0) {
      // For vision models, create content array with text first, then images
      userMessageContent = [{ type: 'text', text }, ...imageContent];
      console.log(`[askOpenAI] Formatted vision message:`, {
        imageCount: imageContent.length,
        contentArrayLength: userMessageContent.length,
        textPart: userMessageContent[0],
        imageParts: userMessageContent.slice(1).map((img: any, idx: number) => ({
          index: idx,
          type: img.type,
          hasImageUrl: !!img.image_url,
          imageUrlDetail: img.image_url?.detail,
        })),
      });
    } else {
      // For text-only models, content is just a string
      userMessageContent = text;
      console.log(`[askOpenAI] Formatted text-only message:`, {
        contentType: typeof userMessageContent,
        contentLength: userMessageContent.length,
      });
    }

    // Create the user message with proper content format
    const userMessage = {
      messageId,
      conversationId,
      parentMessageId: parentMessageId === NO_PARENT ? null : parentMessageId,
      user: oidcUser.sub,
      sender: 'User',
      text, // Original text for database storage
      content: userMessageContent, // Formatted content for AI processing
      isCreatedByUser: true,
      model: resolvedModel,
      error: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    console.log('[askOpenAI] Created user message:', {
      messageId: userMessage.messageId,
      hasContent: !!userMessage.content,
      contentType: Array.isArray(userMessage.content) ? 'array' : typeof userMessage.content,
      contentLength: Array.isArray(userMessage.content)
        ? userMessage.content.length
        : userMessage.content?.length || 0,
    });

    // Save user message immediately (async)
    const userMessageData: CreateMessageDTO = {
      messageId: userMessage.messageId,
      conversationId,
      parentMessageId: userMessage.parentMessageId || undefined,
      userId: oidcUser.sub,
      sender: userMessage.sender,
      text: userMessage.text,
      isCreatedByUser: true,
      model: resolvedModel,
      error: false,
      fileIds: files?.map((f) => f.file_id),
    };

    const userMessagePromise = messageRepository.create(userMessageData);

    // Generate response message ID
    const responseMessageId = crypto.randomUUID();

    // Start database operations (non-blocking)
    const [conversation, savedUserMessage] = await Promise.all([
      conversationPromise,
      userMessagePromise,
    ]);

    // Check if this is the first message for title generation
    const shouldGenerateTitle =
      isNewConversation && (!parentMessageId || parentMessageId === NO_PARENT);

    console.log('[askOpenAI] Title generation check:', {
      isNewConversation,
      parentMessageId,
      shouldGenerateTitle,
      conversationId,
    });

    // Build conversation history for context
    let conversationHistory: Array<{
      role: 'user' | 'assistant';
      content: string | Array<{ type: string; text?: string; image_url?: any }>;
    }> = [];

    if (!isNewConversation && messageId && parentMessageId && parentMessageId !== NO_PARENT) {
      console.log('[askOpenAI] Building conversation history from message chain');

      try {
        // Get conversation history by following parentMessageId chain
        const historyMessages = await messageRepository.getConversationHistory(
          conversationId,
          oidcUser.sub,
          parentMessageId, // Use parentMessageId as the starting point
        );

        // Convert to OpenAI format
        conversationHistory = historyMessages.map((msg) => ({
          role: msg.isCreatedByUser ? 'user' : 'assistant',
          content: msg.text || '',
        }));

        console.log('[askOpenAI] Conversation history built:', {
          historyLength: conversationHistory.length,
          messageTypes: conversationHistory.map((m) => m.role),
        });
      } catch (error) {
        console.error('[askOpenAI] Error building conversation history:', error);
        // Continue with empty history rather than failing
        conversationHistory = [];
      }
    } else {
      console.log('[askOpenAI] New conversation or no parent - no history needed');
    }

    // Add current user message to the conversation with images if present
    if (imageContent.length > 0) {
      conversationHistory.push({
        role: 'user',
        content: userMessage.content,
      });

      console.log('[askOpenAI] Added user message with images to conversation history:', {
        contentParts: Array.isArray(userMessage.content) ? userMessage.content.length : 'N/A',
        imageCount: imageContent.length,
        conversationHistoryLength: conversationHistory.length,
        lastMessageRole: conversationHistory[conversationHistory.length - 1]?.role,
        lastMessageContentType: Array.isArray(
          conversationHistory[conversationHistory.length - 1]?.content,
        )
          ? 'array'
          : typeof conversationHistory[conversationHistory.length - 1]?.content,
      });
    } else {
      conversationHistory.push({
        role: 'user',
        content: text,
      });

      console.log('[askOpenAI] Added text-only user message to conversation history:', {
        conversationHistoryLength: conversationHistory.length,
        lastMessageRole: conversationHistory[conversationHistory.length - 1]?.role,
        lastMessageContentLength: text.length,
      });
    }

    console.log('[askOpenAI] Final conversation history before streaming:', {
      totalMessages: conversationHistory.length,
      messageTypes: conversationHistory.map((msg, idx) => ({
        index: idx,
        role: msg.role,
        contentType: Array.isArray(msg.content) ? 'array' : typeof msg.content,
        contentLength: Array.isArray(msg.content)
          ? msg.content.length
          : (msg.content as string)?.length || 0,
      })),
    });

    // Use SSE Service for streaming
    return streamSSE(c, async (stream) => {
      console.log('[askOpenAI] Starting SSE stream with options:', {
        model: resolvedModel,
        responseMessageId,
        parentMessageId: messageId,
        conversationId,
        fileIds: files?.map((f) => f.file_id) || [],
        userId: oidcUser.sub,
        messagesCount: conversationHistory.length,
      });

      const sseService = new SseService();
      const streamingService = new OpenAIStreamingService(c.env.OPENAI_API_KEY);

      console.log('[askOpenAI] Created SSE service and OpenAI streaming service');

      await sseService.streamResponse(stream, {
        streamingService,
        streamingOptions: {
          messages: conversationHistory,
          model: resolvedModel,
          responseMessageId,
          parentMessageId: messageId,
          conversationId,
          fileIds: files?.map((f) => f.file_id),
          userId: oidcUser.sub,
          systemMessage: modelConfig?.systemMessage,
          temperature: modelConfig?.temperature,
          topP: modelConfig?.topP,
          frequencyPenalty: modelConfig?.frequencyPenalty,
          presencePenalty: modelConfig?.presencePenalty,
          stopSequences: modelConfig?.stopSequences,
          maxTokens: modelConfig?.maxTokens || modelConfig?.maxOutput,
        },
        userMessage: {
          messageId: userMessage.messageId,
          parentMessageId: userMessage.parentMessageId,
          conversationId: conversationId!,
          sender: userMessage.sender,
          text: userMessage.text,
          isCreatedByUser: userMessage.isCreatedByUser,
        },
        responseMessage: {
          messageId: responseMessageId,
          model: resolvedModel,
          endpoint: endpoint || 'openAI',
        },
        conversation: conversation
          ? {
              ...conversation,
              user: oidcUser.sub,
            }
          : null,
        // Handle completion events (persistence, title generation)
        onComplete: async (result: SseCompletionResult) => {
          // Save response message to database
          const responseMessageData: CreateMessageDTO = {
            messageId: result.responseMessage.messageId,
            conversationId: conversationId!,
            parentMessageId: messageId,
            userId: oidcUser.sub,
            sender: 'assistant',
            text: result.responseText,
            isCreatedByUser: false,
            model: resolvedModel,
            error: false,
            tokenCount: result.tokenCount,
          };

          try {
            await messageRepository.create(responseMessageData);
            console.log('[askOpenAI] Response message saved successfully');
          } catch (error) {
            console.error('[askOpenAI] Error saving response message:', error);
          }

          // Generate title for new conversations
          if (shouldGenerateTitle) {
            console.log(
              '[askOpenAI] Generating title for conversation (synchronously):',
              conversationId,
            );
            try {
              await generateConversationTitle(
                c.env.OPENAI_API_KEY,
                oidcUser.sub,
                conversationId!,
                text,
                result.responseText,
                conversationRepository,
                c.env as any,
              );
              console.log('[askOpenAI] Title generation completed successfully');
            } catch (error) {
              console.error('[askOpenAI] Error generating title:', error);
            }
          }
        },
      });
    });
  } catch (error) {
    console.error('[askOpenAI] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Generates a conversation title asynchronously and caches it for retrieval
 * @param apiKey OpenAI API key
 * @param userId User ID for cache key
 * @param conversationId Conversation ID
 * @param userText User's input text
 * @param responseText AI's response text
 * @param conversationRepo Repository for updating conversation
 * @param env Environment bindings
 */
async function generateConversationTitle(
  apiKey: string,
  userId: string,
  conversationId: string,
  userText: string,
  responseText: string,
  conversationRepo: ConversationRepository,
  env: any,
): Promise<void> {
  try {
    console.log('[generateConversationTitle] Starting title generation for:', conversationId);

    // Initialize title service
    const titleService = new OpenAITitleService(apiKey);

    // Generate title
    const title = await titleService.generateTitle(userText, responseText);

    console.log('[generateConversationTitle] Generated title:', title);

    // Update conversation with new title
    await conversationRepo.update(conversationId, userId, { title });

    // Cache the title for frontend retrieval (matching LibreChat pattern)
    const cacheKey = `title:${userId}:${conversationId}`;
    const titleCache = env.TITLE_CACHE;

    if (titleCache) {
      // Cache for 2 minutes (120 seconds)
      await titleCache.put(cacheKey, title, { expirationTtl: 120 });
      console.log('[generateConversationTitle] Cached title with key:', cacheKey);
    } else {
      console.warn('[generateConversationTitle] TITLE_CACHE not configured - title not cached');
    }
  } catch (error) {
    console.error('[generateConversationTitle] Error:', error);
  }
}
