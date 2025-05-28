import { Context } from 'hono';
import { getAuth } from '@hono/oidc-auth';
import { streamSSE } from 'hono/streaming';
import { ConversationRepository } from '../../db/repositories/conversation';
import { MessageRepository } from '../../db/repositories/message';
import { AnthropicStreamingService } from '../../services/AnthropicStreamingService';
import { AnthropicTitleService } from '../../services/AnthropicTitleService';
import { SseService, SseCompletionResult } from '../../services/SseService';
import { AskRequest, CreateConversationDTO, CreateMessageDTO } from '../../types';

// Constants for parent message ID handling (matching LibreChat)
const NO_PARENT = '00000000-0000-0000-0000-000000000000';

/**
 * Handler for POST /api/ask/anthropic
 * Processes chat completion requests with Anthropic's Claude model using the shared streaming service
 * Returns streaming Server-Sent Events (SSE) responses compatible with LibreChat
 * Includes automatic title generation for new conversations
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
    } = requestData;

    console.log('[askAnthropic] Processing request:', {
      userId: oidcUser.sub,
      conversationId: requestConversationId,
      messageLength: text.length,
      model,
    });

    // Initialize repositories
    const conversationRepository = new ConversationRepository(c.env.DB);
    const messageRepository = new MessageRepository(c.env.DB);

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
        model,
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
      model,
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
      model,
      error: false,
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
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (!isNewConversation && messageId && parentMessageId && parentMessageId !== NO_PARENT) {
      console.log('[askAnthropic] Building conversation history from message chain');

      try {
        // Get conversation history by following parentMessageId chain
        const historyMessages = await messageRepository.getConversationHistory(
          conversationId,
          oidcUser.sub,
          parentMessageId, // Use parentMessageId as the starting point, not messageId
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

    // Add current user message to the conversation
    conversationHistory.push({
      role: 'user',
      content: text,
    });

    // Use SSE Service for streaming
    return streamSSE(c, async (stream) => {
      const sseService = new SseService();
      const streamingService = new AnthropicStreamingService(c.env.ANTHROPIC_API_KEY);

      await sseService.streamResponse(stream, {
        streamingService,
        streamingOptions: {
          messages: conversationHistory,
          model,
          responseMessageId,
          parentMessageId: messageId,
          conversationId,
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
          model: model || 'claude-sonnet-4-20250514',
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

          // Generate title for new conversations
          if (shouldGenerateTitle) {
            console.log(
              '[askAnthropic] Generating title for conversation (synchronously):',
              conversationId,
            );
            try {
              await generateConversationTitle(
                c.env.ANTHROPIC_API_KEY,
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
        onError: async (error: Error) => {
          console.error('[askAnthropic] Error in SSE streaming:', error);
        },
      });
    });
  } catch (error) {
    console.error('[askAnthropic] Error processing request:', error);
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
    const titleService = new AnthropicTitleService(apiKey);

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
