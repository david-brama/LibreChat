import { Context } from 'hono';
import { getAuth } from '@hono/oidc-auth';
import { streamSSE } from 'hono/streaming';
import { ConversationRepository } from '../../db/repositories/conversation';
import { MessageRepository } from '../../db/repositories/message';
import { FileRepository } from '../../db/repositories/fileRepository';
import { R2ImageEncoder } from '../../services/files/r2ImageEncoder';
import { AnthropicStreamingService } from '../../services/AnthropicStreamingService';
import { OpenAITitleService } from '../../services/OpenAITitleService';
import { SseService, SseCompletionResult } from '../../services/SseService';
import { AskRequest, CreateConversationDTO, CreateMessageDTO } from '../../types';
import { ModelRepository } from '../../db/repositories/model';

// Constants for parent message ID handling (matching LibreChat)
const NO_PARENT = '00000000-0000-0000-0000-000000000000';

/**
 * Handler for POST /api/ask/anthropic
 * Processes chat completion requests with Anthropic's Claude model using the streaming service
 * Returns streaming Server-Sent Events (SSE) responses compatible with LibreChat
 * Includes automatic title generation for new conversations and image support for vision models
 */
export async function askAnthropic(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Check if Anthropic API key is available
    if (!c.env.ANTHROPIC_API_KEY) {
      console.error('[askAnthropic] ANTHROPIC_API_KEY not configured');
      return c.json({ error: 'Anthropic API key not configured' }, 500);
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
        console.log('[askAnthropic] Resolved spec to model:', {
          spec,
          resolvedModel,
          modelLabel: modelConfig.label,
          hasSystemMessage: !!modelConfig.systemMessage,
          systemMessageLength: modelConfig.systemMessage?.length,
          systemMessagePreview: modelConfig.systemMessage?.substring(0, 100),
        });
      } else {
        console.warn('[askAnthropic] Spec not found, falling back to model parameter:', {
          spec,
          fallbackModel: model,
        });
      }
    }

    if (!resolvedModel) {
      return c.json({ error: 'No model specified (spec or model parameter required)' }, 400);
    }

    console.log('[askAnthropic] Processing request:', {
      userId: oidcUser.sub,
      conversationId: requestConversationId,
      messageLength: text.length,
      spec,
      model: resolvedModel,
      hasFiles: !!files?.length,
      fileCount: files?.length || 0,
    });

    // Initialize repositories
    const conversationRepository = new ConversationRepository(c.env.DB);
    const messageRepository = new MessageRepository(c.env.DB);
    const fileRepository = new FileRepository(c.env.DB);

    // Initialize image encoder for file processing
    const imageEncoder = new R2ImageEncoder(c.env.R2_BUCKET, fileRepository);

    // Process files if present
    let imageContent: any[] = [];
    let processedFiles: any[] = [];

    if (files && files.length > 0) {
      console.log('[askAnthropic] Processing files for vision request:', {
        fileIds: files.map((f) => f.file_id),
      });

      try {
        const fileIds = files.map((f) => f.file_id);
        const fileProcessingResult = await imageEncoder.encodeAndFormat(
          fileIds,
          oidcUser.sub,
          'anthropic',
        );

        imageContent = fileProcessingResult.image_urls;
        processedFiles = fileProcessingResult.files;

        console.log('[askAnthropic] File processing completed:', {
          imageCount: imageContent.length,
          processedFileCount: processedFiles.length,
          hasTextContent: !!fileProcessingResult.text,
        });

        // Log any text content from files (documents)
        if (fileProcessingResult.text) {
          console.log('[askAnthropic] Text content extracted from files:', {
            textLength: fileProcessingResult.text.length,
          });
        }
      } catch (error) {
        console.error('[askAnthropic] Error processing files:', error);
        // Continue without images rather than failing the request
        imageContent = [];
        processedFiles = [];
      }
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
      console.log('[askAnthropic] Creating new conversation:', conversationId);
    } else {
      conversationPromise = conversationRepository.findByIdAndUser(conversationId, oidcUser.sub);
    }

    // Create user message immediately (following LibreChat pattern)
    const userMessage = {
      messageId,
      conversationId,
      parentMessageId: parentMessageId === NO_PARENT ? null : parentMessageId,
      user: oidcUser.sub,
      sender: 'User',
      text,
      isCreatedByUser: true,
      model: resolvedModel,
      error: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save user message immediately (async)
    const userMessageData: CreateMessageDTO = {
      messageId: userMessage.messageId,
      conversationId,
      parentMessageId: userMessage.parentMessageId || undefined,
      userId: oidcUser.sub,
      sender: userMessage.sender,
      text: userMessage.text,
      isCreatedByUser: true,
      model: userMessage.model,
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

    console.log('[askAnthropic] Title generation check:', {
      isNewConversation,
      parentMessageId,
      shouldGenerateTitle,
      conversationId,
    });

    // Build conversation history for context
    let conversationHistory: Array<{
      role: 'user' | 'assistant';
      content: string | Array<{ type: string; text?: string; source?: any }>;
    }> = [];

    if (!isNewConversation && messageId && parentMessageId && parentMessageId !== NO_PARENT) {
      console.log('[askAnthropic] Building conversation history from message chain');

      try {
        // Get conversation history by following parentMessageId chain
        const historyMessages = await messageRepository.getConversationHistory(
          conversationId,
          oidcUser.sub,
          parentMessageId, // Use parentMessageId as the starting point
        );

        // Convert to Anthropic format
        conversationHistory = historyMessages.map((msg) => ({
          role: msg.isCreatedByUser ? 'user' : 'assistant',
          content: msg.text || '',
        }));

        console.log('[askAnthropic] Conversation history built:', {
          historyLength: conversationHistory.length,
          messageTypes: conversationHistory.map((m) => m.role),
        });
      } catch (error) {
        console.error('[askAnthropic] Error building conversation history:', error);
        // Continue with empty history rather than failing
        conversationHistory = [];
      }
    } else {
      console.log('[askAnthropic] New conversation or no parent - no history needed');
    }

    // Add current user message to the conversation with images if present
    if (imageContent.length > 0) {
      // For Anthropic, format message content as array with text and images
      const messageContent: Array<{ type: string; text?: string; source?: any }> = [
        { type: 'text', text },
      ];

      // Add images to the message content
      messageContent.push(...imageContent);

      conversationHistory.push({
        role: 'user',
        content: messageContent,
      });

      console.log('[askAnthropic] Added user message with images:', {
        contentParts: messageContent.length,
        imageCount: imageContent.length,
      });
    } else {
      // Text-only message
      conversationHistory.push({
        role: 'user',
        content: text,
      });

      console.log('[askAnthropic] Added text-only user message');
    }

    // Use SSE Service for streaming
    return streamSSE(c, async (stream) => {
      const sseService = new SseService();
      const streamingService = new AnthropicStreamingService(c.env.ANTHROPIC_API_KEY);

      console.log('[askAnthropic] About to call streaming service with options:', {
        model: resolvedModel,
        responseMessageId,
        parentMessageId: messageId,
        conversationId,
        hasSystemMessage: !!modelConfig?.systemMessage,
        systemMessage: modelConfig?.systemMessage
          ? `"${modelConfig.systemMessage.substring(0, 200)}..."`
          : 'NOT_SET',
        temperature: modelConfig?.temperature,
        topP: modelConfig?.topP,
        topK: modelConfig?.topK,
      });

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
          topK: modelConfig?.topK,
          stopSequences: modelConfig?.stopSequences,
          promptCache: modelConfig?.promptCache,
          thinkingBudget: modelConfig?.thinkingBudget,
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
          endpoint: endpoint || 'anthropic',
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
            model: result.responseMessage.model,
            error: false,
            tokenCount: result.tokenCount,
          };

          try {
            await messageRepository.create(responseMessageData);
            console.log('[askAnthropic] Response message saved successfully');
          } catch (error) {
            console.error('[askAnthropic] Error saving response message:', error);
          }

          // Generate title for new conversations using OpenAI
          if (shouldGenerateTitle && c.env.OPENAI_API_KEY) {
            console.log(
              '[askAnthropic] Generating title for conversation (synchronously):',
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
              console.log('[askAnthropic] Title generation completed successfully');
            } catch (error) {
              console.error('[askAnthropic] Error generating title:', error);
            }
          }
        },
      });
    });
  } catch (error) {
    console.error('[askAnthropic] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Generates a conversation title asynchronously and caches it for retrieval
 * @param apiKey Anthropic API key
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
