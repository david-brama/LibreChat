import { Context } from 'hono';
import { getAuth } from '@hono/oidc-auth';
import { streamSSE } from 'hono/streaming';
import { ConversationRepository } from '../../db/repositories/conversation';
import { MessageRepository } from '../../db/repositories/message';
import { AnthropicStreamingService, AnthropicTitleService } from '../../models/anthropic-streaming';
import { AskRequest, StreamingMessage, CreateConversationDTO, CreateMessageDTO } from '../../types';

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
      parentMessageId:
        parentMessageId === '00000000-0000-0000-0000-000000000000' ? null : parentMessageId,
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
      isNewConversation &&
      (!parentMessageId || parentMessageId === '00000000-0000-0000-0000-000000000000');

    console.log('[askAnthropic] Title generation check:', {
      isNewConversation,
      parentMessageId,
      shouldGenerateTitle,
      conversationId,
    });

    // Use Hono's streamSSE with shared service
    return streamSSE(c, async (stream) => {
      try {
        // Send initial "created" event with user message (matches LibreChat format)
        const initialCreatedEvent = {
          message: {
            messageId: userMessage.messageId,
            parentMessageId: userMessage.parentMessageId || '00000000-0000-0000-0000-000000000000',
            conversationId: conversationId,
            sender: userMessage.sender,
            text: userMessage.text,
            isCreatedByUser: userMessage.isCreatedByUser,
          },
          created: true,
        };

        await stream.writeSSE({
          data: JSON.stringify(initialCreatedEvent),
          event: 'message',
        });

        // Initialize streaming service
        const streamingService = new AnthropicStreamingService(c.env.ANTHROPIC_API_KEY);

        // Stream response using shared service
        const { responseText, tokenCount } = await streamingService.streamResponse(stream, {
          apiKey: c.env.ANTHROPIC_API_KEY,
          messages: [
            {
              role: 'user',
              content: text,
            },
          ],
          model,
          responseMessageId,
          parentMessageId: messageId,
          conversationId,
          // Save response message after streaming completes
          onComplete: async (responseText: string, tokenCount: number) => {
            const responseMessageData: CreateMessageDTO = {
              messageId: responseMessageId,
              conversationId: conversationId!,
              parentMessageId: messageId,
              userId: oidcUser.sub,
              sender: 'assistant',
              text: responseText,
              isCreatedByUser: false,
              model: model || 'claude-sonnet-4-20250514',
              error: false,
              tokenCount,
            };

            // Save to database (non-blocking)
            messageRepository.create(responseMessageData).catch((error) => {
              console.error('[askAnthropic] Error saving response message:', error);
            });
          },
        });

        // Generate title for new conversations AFTER streaming but BEFORE returning
        // This ensures title generation happens within the same request lifecycle
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
              responseText,
              conversationRepository,
              c.env as any,
            );
            console.log('[askAnthropic] Title generation completed successfully');
          } catch (error) {
            console.error('[askAnthropic] Error generating title:', error);
          }
        } else {
          console.log(
            '[askAnthropic] Skipping title generation - not a new conversation or has parent message',
          );
        }

        // Create final response message for the SSE final event
        const responseMessage = {
          messageId: responseMessageId,
          conversationId,
          parentMessageId: messageId,
          isCreatedByUser: false,
          model: model || 'claude-sonnet-4-20250514',
          sender: model || 'claude-sonnet-4-20250514',
          promptTokens: 0, // TODO: Calculate actual prompt tokens
          iconURL: 'anthropic',
          endpoint: 'anthropic',
          finish_reason: 'stop',
          text: responseText,
          tokenCount,
        };

        // Send final response (matches LibreChat format)
        const finalResponse = {
          final: true,
          conversation: conversation || {
            _id: conversationId, // MongoDB-style ID for compatibility
            conversationId,
            user: oidcUser.sub,
            __v: 0,
            createdAt: new Date().toISOString(),
            endpoint: endpoint || 'anthropic',
            expiredAt: null,
            files: [],
            frequency_penalty: 0.1,
            iconURL: 'anthropic',
            isArchived: false,
            messages: [userMessage.messageId, responseMessageId],
            model: model || 'claude-sonnet-4-20250514',
            modelLabel: model || 'Claude 3.5 Sonnet',
            presence_penalty: 0.1,
            resendFiles: true,
            spec: 'anthropic',
            tags: [],
            temperature: 0.2,
            title: conversation?.title || 'New Chat',
            top_p: 0.85,
            updatedAt: new Date().toISOString(),
          },
          title: conversation?.title || 'New Chat',
          requestMessage: {
            messageId: userMessage.messageId,
            parentMessageId: userMessage.parentMessageId || '00000000-0000-0000-0000-000000000000',
            conversationId,
            sender: userMessage.sender,
            text: userMessage.text,
            isCreatedByUser: userMessage.isCreatedByUser,
            tokenCount: 0, // TODO: Calculate actual token count for user message
          },
          responseMessage,
        };

        await stream.writeSSE({
          data: JSON.stringify(finalResponse),
          event: 'message',
        });
      } catch (error) {
        console.error('[askAnthropic] Error in streaming:', error);
        // Error already sent by streaming service
      }
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
