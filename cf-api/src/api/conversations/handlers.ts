import { Context } from 'hono';
import { getAuth } from '@hono/oidc-auth';
import { ConversationRepository } from '../../db/repositories/conversation';
import { ConversationListParams, tConversationSchema, type Conversation } from '../../types';

/**
 * Handler for GET /api/convos
 * Lists conversations for the authenticated user with pagination and filtering
 */
export async function listConversations(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Parse query parameters
    const params: ConversationListParams = {
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit') ? parseInt(c.req.query('limit') as string, 10) : 25,
      isArchived: c.req.query('isArchived') === 'true',
      order: (c.req.query('order') as 'asc' | 'desc') || 'desc',
      search: c.req.query('search')
        ? decodeURIComponent(c.req.query('search') as string)
        : undefined,
    };

    // Parse tags parameter (can be array or single value)
    const tagsParam = c.req.query('tags');
    if (tagsParam) {
      params.tags = Array.isArray(tagsParam) ? tagsParam : [tagsParam];
    }

    // Get conversations from database
    const conversationRepo = new ConversationRepository(c.env.DB);
    const result = await conversationRepo.findByUser(oidcUser.sub, params);

    // Validate conversations conform to schema
    const validatedConversations = result.conversations.map((conversation) => {
      const validationResult = tConversationSchema.safeParse(conversation);
      if (!validationResult.success) {
        console.warn('[listConversations] Conversation validation warning:', {
          conversationId: conversation.conversationId,
          errors: validationResult.error.errors,
        });
        // Return the conversation anyway but log the validation issue
        return conversation;
      }
      return validationResult.data;
    });

    return c.json({
      ...result,
      conversations: validatedConversations,
    });
  } catch (error) {
    console.error('[listConversations] Error:', error);
    return c.json({ error: 'Error fetching conversations' }, 500);
  }
}

/**
 * Handler for GET /api/convos/:conversationId
 * Gets a single conversation by ID for the authenticated user
 */
export async function getConversation(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const conversationId = c.req.param('conversationId');
    if (!conversationId) {
      return c.json({ error: 'conversationId is required' }, 400);
    }

    // Get conversation from database
    const conversationRepo = new ConversationRepository(c.env.DB);
    const conversation = await conversationRepo.findByIdAndUser(conversationId, oidcUser.sub);

    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    // Validate conversation conforms to schema
    const validationResult = tConversationSchema.safeParse(conversation);
    if (!validationResult.success) {
      console.warn('[getConversation] Conversation validation warning:', {
        conversationId: conversation.conversationId,
        errors: validationResult.error.errors,
      });
      // Return the conversation anyway but log the validation issue
      return c.json(conversation);
    }

    return c.json(validationResult.data);
  } catch (error) {
    console.error('[getConversation] Error:', error);
    return c.json({ error: 'Error fetching conversation' }, 500);
  }
}

/**
 * Handler for POST /api/convos/update
 * Updates an existing conversation
 */
export async function updateConversation(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const updateData = body.arg;

    if (!updateData?.conversationId) {
      return c.json({ error: 'conversationId is required' }, 400);
    }

    // Prepare update data
    const {
      conversationId,
      title,
      endpoint,
      model,
      isArchived,
      tags,
      // Extract other model parameters for settings
      temperature,
      top_p,
      max_tokens,
      // Extract metadata fields
      iconURL,
      greeting,
      spec,
      ...otherFields
    } = updateData;

    const updateDto = {
      title,
      endpoint,
      model,
      isArchived,
      tags,
      settings: {
        temperature,
        top_p,
        max_tokens,
        ...Object.keys(otherFields).reduce(
          (acc, key) => {
            // Include other model parameters in settings
            if (
              typeof otherFields[key] !== 'undefined' &&
              !['conversationId', 'user'].includes(key)
            ) {
              acc[key] = otherFields[key];
            }
            return acc;
          },
          {} as Record<string, any>,
        ),
      },
      metadata: {
        iconURL,
        greeting,
        spec,
      },
    };

    // Update conversation in database
    const conversationRepo = new ConversationRepository(c.env.DB);
    const updatedConversation = await conversationRepo.update(
      conversationId,
      oidcUser.sub,
      updateDto,
    );

    if (!updatedConversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    // Validate updated conversation conforms to schema
    const validationResult = tConversationSchema.safeParse(updatedConversation);
    if (!validationResult.success) {
      console.warn('[updateConversation] Conversation validation warning:', {
        conversationId: updatedConversation.conversationId,
        errors: validationResult.error.errors,
      });
      // Return the conversation anyway but log the validation issue
      return c.json(updatedConversation, 201);
    }

    return c.json(validationResult.data, 201);
  } catch (error) {
    console.error('[updateConversation] Error:', error);
    return c.json({ error: 'Error updating conversation' }, 500);
  }
}

/**
 * Handler for DELETE /api/convos
 * Deletes one or more conversations
 */
export async function deleteConversations(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { conversationId, source } = body.arg || {};

    // Prevent deletion of all conversations without explicit confirmation
    if (!conversationId && !source) {
      return c.json({ error: 'no parameters provided' }, 400);
    }

    if (source === 'button' && !conversationId) {
      return c.json({ message: 'No conversationId provided' }, 200);
    }

    const conversationRepo = new ConversationRepository(c.env.DB);

    if (conversationId) {
      // Delete specific conversation
      const deleted = await conversationRepo.delete(conversationId, oidcUser.sub);
      if (!deleted) {
        return c.json({ error: 'Conversation not found or already deleted' }, 404);
      }
      return c.json({ deletedCount: 1 }, 201);
    }

    // If no specific conversation ID, this would be handled by a different endpoint
    return c.json({ error: 'Invalid delete operation' }, 400);
  } catch (error) {
    console.error('[deleteConversations] Error:', error);
    return c.json({ error: 'Error deleting conversations' }, 500);
  }
}

/**
 * Handler for DELETE /api/convos/all
 * Deletes all conversations for the authenticated user
 */
export async function deleteAllConversations(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const conversationRepo = new ConversationRepository(c.env.DB);
    const deletedCount = await conversationRepo.deleteAllByUser(oidcUser.sub);

    return c.json({ deletedCount }, 201);
  } catch (error) {
    console.error('[deleteAllConversations] Error:', error);
    return c.json({ error: 'Error clearing conversations' }, 500);
  }
}
