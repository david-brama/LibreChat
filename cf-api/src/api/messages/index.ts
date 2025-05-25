import { Hono } from 'hono';
import { getAuth } from '@hono/oidc-auth';
import { MessageRepository } from '../../db/repositories/message';
import { tMessageSchema, type Message } from '../../types';

const messages = new Hono<{ Bindings: CloudflareBindings }>();

/**
 * GET /api/messages/:conversationId
 * Retrieves all messages for a specific conversation
 * Used by LibreChat frontend to load conversation history
 */
messages.get('/:conversationId', async (c) => {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Get conversation ID from URL parameters
    const conversationId = c.req.param('conversationId');
    if (!conversationId) {
      return c.json({ error: 'Conversation ID is required' }, 400);
    }

    console.log('[GET /api/messages] Retrieving messages:', {
      userId: oidcUser.sub,
      conversationId,
    });

    // Initialize message repository
    const messageRepository = new MessageRepository(c.env.DB);

    // Get all messages for the conversation
    const messages = await messageRepository.findByConversationId(conversationId, oidcUser.sub);

    console.log('[GET /api/messages] Found messages:', {
      conversationId,
      messageCount: messages.length,
    });

    // Validate and return messages in LibreChat expected format
    const validatedMessages = messages.map((message) => {
      const result = tMessageSchema.safeParse(message);
      if (!result.success) {
        console.warn('[GET /api/messages] Message validation warning:', {
          messageId: message.messageId,
          errors: result.error.errors,
        });
        // Return the message anyway but log the validation issue
        return message;
      }
      return result.data;
    });

    return c.json(validatedMessages);
  } catch (error) {
    console.error('[GET /api/messages] Error retrieving messages:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/messages/:conversationId/:messageId
 * Retrieves a specific message by ID
 * Used for individual message operations
 */
messages.get('/:conversationId/:messageId', async (c) => {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Get parameters
    const conversationId = c.req.param('conversationId');
    const messageId = c.req.param('messageId');

    if (!conversationId || !messageId) {
      return c.json({ error: 'Conversation ID and Message ID are required' }, 400);
    }

    console.log('[GET /api/messages/:messageId] Retrieving message:', {
      userId: oidcUser.sub,
      conversationId,
      messageId,
    });

    // Initialize message repository
    const messageRepository = new MessageRepository(c.env.DB);

    // Get the specific message
    const message = await messageRepository.findByIdAndUser(messageId, oidcUser.sub);

    if (!message) {
      return c.json({ error: 'Message not found' }, 404);
    }

    // Verify the message belongs to the requested conversation
    if (message.conversationId !== conversationId) {
      return c.json({ error: 'Message does not belong to this conversation' }, 400);
    }

    console.log('[GET /api/messages/:messageId] Found message:', {
      messageId,
      conversationId,
      sender: message.sender,
    });

    // Validate and return message in LibreChat expected format
    const result = tMessageSchema.safeParse(message);
    if (!result.success) {
      console.warn('[GET /api/messages/:messageId] Message validation warning:', {
        messageId: message.messageId,
        errors: result.error.errors,
      });
      // Return the message anyway but log the validation issue
      return c.json(message);
    }

    return c.json(result.data);
  } catch (error) {
    console.error('[GET /api/messages/:messageId] Error retrieving message:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * PUT /api/messages/:conversationId/:messageId
 * Updates a specific message
 * Used by LibreChat frontend when editing messages
 */
messages.put('/:conversationId/:messageId', async (c) => {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Get parameters
    const conversationId = c.req.param('conversationId');
    const messageId = c.req.param('messageId');

    if (!conversationId || !messageId) {
      return c.json({ error: 'Conversation ID and Message ID are required' }, 400);
    }

    // Parse request body
    const body = await c.req.json();
    const { text, index, model } = body;

    console.log('[PUT /api/messages/:messageId] Updating message:', {
      userId: oidcUser.sub,
      conversationId,
      messageId,
      hasText: !!text,
      index,
      model,
    });

    // Initialize message repository
    const messageRepository = new MessageRepository(c.env.DB);

    // Verify the message exists and belongs to the user
    const existingMessage = await messageRepository.findByIdAndUser(messageId, oidcUser.sub);
    if (!existingMessage) {
      return c.json({ error: 'Message not found' }, 404);
    }

    // Verify the message belongs to the requested conversation
    if (existingMessage.conversationId !== conversationId) {
      return c.json({ error: 'Message does not belong to this conversation' }, 400);
    }

    // Handle index-based content updates (for content arrays)
    if (index !== undefined) {
      // For now, we'll handle simple text updates
      // TODO: Implement proper content array handling when needed
      console.warn(
        '[PUT /api/messages/:messageId] Index-based content updates not fully implemented',
      );
      return c.json({ error: 'Index-based content updates not yet supported' }, 400);
    }

    // Handle simple text updates
    if (!text) {
      return c.json({ error: 'Text is required for message updates' }, 400);
    }

    // Update the message
    const updatedMessage = await messageRepository.update(messageId, oidcUser.sub, {
      text,
      // Note: We could add token count calculation here if needed
      // tokenCount: await countTokens(text, model),
    });

    if (!updatedMessage) {
      return c.json({ error: 'Failed to update message' }, 500);
    }

    console.log('[PUT /api/messages/:messageId] Message updated successfully:', {
      messageId,
      conversationId,
    });

    // Validate and return the updated message
    const result = tMessageSchema.safeParse(updatedMessage);
    if (!result.success) {
      console.warn('[PUT /api/messages/:messageId] Updated message validation warning:', {
        messageId: updatedMessage.messageId,
        errors: result.error.errors,
      });
      // Return the message anyway but log the validation issue
      return c.json(updatedMessage);
    }

    return c.json(result.data);
  } catch (error) {
    console.error('[PUT /api/messages/:messageId] Error updating message:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default messages;
