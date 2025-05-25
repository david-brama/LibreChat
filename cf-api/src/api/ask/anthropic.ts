import { Context } from 'hono';
import { getAuth } from '@hono/oidc-auth';
import { streamSSE } from 'hono/streaming';
import { ConversationRepository } from '../../db/repositories/conversation';
import { MessageRepository } from '../../db/repositories/message';
import { AnthropicStreamingService } from '../../models/anthropic-streaming';
import { AskRequest, StreamingMessage, CreateConversationDTO, CreateMessageDTO } from '../../types';

/**
 * Handler for POST /api/ask/anthropic
 * Processes chat completion requests with Anthropic's Claude model using the shared streaming service
 * Returns streaming Server-Sent Events (SSE) responses compatible with LibreChat
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

    if (!conversationId || conversationId === 'null') {
      // Generate new conversation ID
      conversationId = crypto.randomUUID();

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

    // Use Hono's streamSSE with shared service
    return streamSSE(c, async (stream) => {
      try {
        // Send initial conversation data if it's a new conversation
        if (!requestConversationId || requestConversationId === 'null') {
          const initialResponse: StreamingMessage = {
            conversation: conversation || {
              conversationId,
              user: oidcUser.sub,
              title: 'New Chat',
              endpoint,
              model,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            title: conversation?.title || 'New Chat',
            requestMessage: userMessage,
          };

          await stream.writeSSE({
            data: JSON.stringify(initialResponse),
            event: 'message',
          });
        }

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
              model: model || 'claude-3-5-sonnet-20241022',
              error: false,
              tokenCount,
            };

            // Save to database (non-blocking)
            messageRepository.create(responseMessageData).catch((error) => {
              console.error('[askAnthropic] Error saving response message:', error);
            });
          },
        });

        // Create final response message for the SSE final event
        const responseMessage = {
          messageId: responseMessageId,
          conversationId,
          parentMessageId: messageId,
          user: oidcUser.sub,
          sender: 'assistant',
          text: responseText,
          isCreatedByUser: false,
          model: model || 'claude-3-5-sonnet-20241022',
          error: false,
          tokenCount,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Send final response
        const finalResponse: StreamingMessage = {
          final: true,
          conversation: conversation || {
            conversationId,
            user: oidcUser.sub,
            title: 'New Chat',
            endpoint,
            model,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          title: conversation?.title || 'New Chat',
          requestMessage: userMessage,
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
