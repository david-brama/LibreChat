import { Hono } from 'hono';
import { getAuth } from '@hono/oidc-auth';
import { streamSSE } from 'hono/streaming';
import { MessageRepository } from '../../db/repositories/message';
import { ConversationRepository } from '../../db/repositories/conversation';
import { AnthropicStreamingService } from '../../services/AnthropicStreamingService';
import { SseService, SseCompletionResult } from '../../services/SseService';
import { StreamingMessage, CreateMessageDTO, Message } from '../../types';

const edit = new Hono<{ Bindings: CloudflareBindings }>();

/**
 * POST /api/edit/anthropic
 * Handles message editing with conversation regeneration
 * Edits a message and regenerates the conversation from that point forward
 *
 * Key understanding from original LibreChat:
 * - parentMessageId in edit requests actually contains the messageId to edit (confusing naming!)
 * - responseMessageId is the assistant message that needs to be updated
 * - We update existing messages instead of creating new ones
 */
edit.post('/anthropic', async (c) => {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const {
      text,
      conversationId,
      parentMessageId,
      responseMessageId,
      overrideParentMessageId,
      generation,
    } = body;

    console.log('[POST /api/edit/anthropic] Editing message and regenerating:', {
      userId: oidcUser.sub,
      conversationId,
      parentMessageId,
      responseMessageId,
      overrideParentMessageId,
      hasText: !!text,
      generation: generation?.substring(0, 100) + '...',
    });

    if (!text || !conversationId) {
      return c.json({ error: 'Text and conversationId are required' }, 400);
    }

    // Check if Anthropic API key is available
    if (!c.env.ANTHROPIC_API_KEY) {
      console.error('[POST /api/edit/anthropic] ANTHROPIC_API_KEY not configured');
      return c.json({ error: 'Anthropic API key not configured' }, 500);
    }

    // Initialize repositories
    const messageRepository = new MessageRepository(c.env.DB);
    const conversationRepository = new ConversationRepository(c.env.DB);

    // Verify conversation exists and belongs to user
    const conversation = await conversationRepository.findByIdAndUser(conversationId, oidcUser.sub);
    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    // Load all messages for this conversation
    const messages = await messageRepository.findByConversationId(conversationId, oidcUser.sub);

    // Determine which messages to update based on LibreChat's logic
    let userMessageToEdit: Message | undefined;
    let assistantMessageToUpdate: Message | undefined;
    let messageIdToEdit: string = '';

    if (responseMessageId) {
      // This is the standard edit flow where we have an assistant response to update
      // Find the assistant message we're updating
      assistantMessageToUpdate = messages.find((msg) => msg.messageId === responseMessageId);

      if (!assistantMessageToUpdate) {
        return c.json({ error: 'Assistant message to update not found' }, 404);
      }

      // The user message to edit is the parent of the assistant message
      userMessageToEdit = messages.find(
        (msg) => msg.messageId === assistantMessageToUpdate!.parentMessageId,
      );

      if (!userMessageToEdit) {
        return c.json({ error: 'User message to edit not found' }, 404);
      }

      messageIdToEdit = userMessageToEdit.messageId;
    } else {
      // Fallback: use the LibreChat naming convention where parentMessageId IS the message to edit
      const userMessageId = parentMessageId;
      messageIdToEdit = overrideParentMessageId || userMessageId;

      if (!messageIdToEdit) {
        return c.json({ error: 'Could not identify message to edit' }, 400);
      }

      userMessageToEdit = messages.find((msg) => msg.messageId === messageIdToEdit);

      if (!userMessageToEdit) {
        return c.json({ error: 'Message to edit not found' }, 404);
      }

      // Find the assistant response that follows this user message
      assistantMessageToUpdate = messages.find(
        (msg) => msg.parentMessageId === messageIdToEdit && !msg.isCreatedByUser,
      );
    }

    console.log('[POST /api/edit/anthropic] Message identification:', {
      userMessageId: messageIdToEdit,
      assistantMessageId: assistantMessageToUpdate?.messageId,
      willUpdateExistingAssistant: !!assistantMessageToUpdate,
    });

    // Update the user message with new text
    const updatedMessage = await messageRepository.update(messageIdToEdit, oidcUser.sub, {
      text,
    });

    if (!updatedMessage) {
      return c.json({ error: 'Failed to update message' }, 500);
    }

    // If editing an assistant message only (no regeneration needed)
    if (responseMessageId && userMessageToEdit && !userMessageToEdit.isCreatedByUser) {
      return c.json(updatedMessage);
    }

    // Build conversation context up to and including the edited user message
    const editedMessageIndex = messages.findIndex((msg) => msg.messageId === messageIdToEdit);
    const contextMessages = messages.slice(0, editedMessageIndex + 1);

    // Update the edited message in our context
    const updatedContextMessages = contextMessages.map((msg) =>
      msg.messageId === messageIdToEdit ? { ...msg, text } : msg,
    );

    // Build conversation messages for Anthropic
    const conversationMessages = updatedContextMessages
      .filter((msg) => msg.sender === 'user' || msg.sender === 'assistant')
      .map((msg) => ({
        role: (msg.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.text,
      }));

    // Use existing assistant message ID if updating, otherwise create new
    const responseMessageIdToUse = assistantMessageToUpdate?.messageId || crypto.randomUUID();
    const isUpdatingExistingAssistant = !!assistantMessageToUpdate;

    console.log('[POST /api/edit/anthropic] Starting streaming response:', {
      conversationId,
      editedMessageId: messageIdToEdit,
      responseMessageId: responseMessageIdToUse,
      isUpdatingExistingAssistant,
      contextLength: conversationMessages.length,
    });

    // Use SSE Service for streaming
    return streamSSE(c, async (stream) => {
      const sseService = new SseService();
      const streamingService = new AnthropicStreamingService(c.env.ANTHROPIC_API_KEY);

      await sseService.streamResponse(stream, {
        streamingService,
        streamingOptions: {
          messages: conversationMessages,
          responseMessageId: responseMessageIdToUse,
          parentMessageId: messageIdToEdit,
          conversationId,
        },
        userMessage: {
          messageId: messageIdToEdit,
          parentMessageId: updatedMessage?.parentMessageId || null,
          conversationId,
          sender: updatedMessage?.sender || 'user',
          text: updatedMessage?.text || text,
          isCreatedByUser: true,
        },
        responseMessage: {
          messageId: responseMessageIdToUse,
          model: 'claude-sonnet-4-20250514',
          endpoint: 'anthropic',
        },
        conversation: {
          ...conversation,
          user: oidcUser.sub,
        },
        // Custom final response builder for edit endpoint
        customFinalResponseBuilder: (result: SseCompletionResult) => ({
          requestMessage: updatedMessage,
          responseMessage: {
            messageId: responseMessageIdToUse,
            conversationId,
            parentMessageId: messageIdToEdit,
            user: oidcUser.sub,
            sender: 'assistant',
            text: result.responseText,
            isCreatedByUser: false,
            model: 'claude-sonnet-4-20250514',
            error: false,
            tokenCount: result.tokenCount,
            createdAt: assistantMessageToUpdate?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
        // Handle completion events (persistence)
        onComplete: async (result: SseCompletionResult) => {
          const responseMessageData: CreateMessageDTO = {
            messageId: responseMessageIdToUse,
            conversationId,
            parentMessageId: messageIdToEdit,
            userId: oidcUser.sub,
            sender: 'assistant',
            text: result.responseText,
            isCreatedByUser: false,
            model: 'claude-sonnet-4-20250514',
            error: false,
            tokenCount: result.tokenCount,
          };

          try {
            if (isUpdatingExistingAssistant) {
              // Update existing assistant message
              await messageRepository.update(responseMessageIdToUse, oidcUser.sub, {
                text: result.responseText,
                tokenCount: result.tokenCount,
              });
              console.log('[POST /api/edit/anthropic] Assistant message updated successfully');
            } else {
              // Create new assistant message
              await messageRepository.create(responseMessageData);
              console.log('[POST /api/edit/anthropic] New assistant message created successfully');
            }

            console.log('[POST /api/edit/anthropic] Edit and regeneration completed:', {
              conversationId,
              editedMessageId: messageIdToEdit,
              responseMessageId: responseMessageIdToUse,
              wasUpdate: isUpdatingExistingAssistant,
            });
          } catch (error) {
            console.error('[POST /api/edit/anthropic] Error saving response message:', error);
            throw error;
          }
        },
        onError: async (error: Error) => {
          console.error('[POST /api/edit/anthropic] Error in SSE streaming:', error);
        },
      });
    });
  } catch (error) {
    console.error('[POST /api/edit/anthropic] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default edit;
