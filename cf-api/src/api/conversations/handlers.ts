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
      limit: c.req.query('limit') ? parseInt(c.req.query('limit') as string, 10) : 20,
      isArchived: c.req.query('isArchived') === 'true',
      tags: c.req.queries('tags[]') || undefined,
      search: c.req.query('search') || undefined,
      order: (c.req.query('order') as 'asc' | 'desc') || 'desc',
    };

    console.log('[GET /convos] Request params:', params);

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
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Handler for GET /api/convos/:id
 * Gets a single conversation by ID for the authenticated user
 */
export async function getConversation(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const conversationId = c.req.param('id');
    if (!conversationId) {
      return c.json({ error: 'conversationId is required' }, 400);
    }

    console.log('[GET /convos/:id] Fetching conversation:', conversationId);

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
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Handler for POST /api/convos/gen_title
 * Generates or retrieves a cached conversation title
 */
export async function generateTitle(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { conversationId } = await c.req.json();
    if (!conversationId) {
      return c.json({ error: 'conversationId is required' }, 400);
    }

    console.log('[POST /convos/gen_title] Request for conversation:', conversationId);

    // Generate cache key (matches LibreChat pattern)
    const cacheKey = `title:${oidcUser.sub}:${conversationId}`;

    // Try to get the cached title from KV storage
    // Note: TITLE_CACHE KV binding needs to be configured in wrangler.jsonc
    const titleCache = c.env.TITLE_CACHE;

    if (!titleCache) {
      console.warn('[POST /convos/gen_title] TITLE_CACHE KV binding not configured');
      return c.json(
        {
          message: 'Title generation not configured - KV storage binding missing',
        },
        404,
      );
    }

    console.log('[POST /convos/gen_title] Looking for cached title with key:', cacheKey);
    let title = await titleCache.get(cacheKey);

    if (!title) {
      console.log('[POST /convos/gen_title] Title not found, waiting 2.5s and retrying...');
      // Wait 2.5 seconds and try again (matching LibreChat behavior)
      await new Promise((resolve) => setTimeout(resolve, 2500));
      title = await titleCache.get(cacheKey);
    }

    if (title) {
      // Delete the cached title after retrieving it
      await titleCache.delete(cacheKey);
      console.log('[POST /convos/gen_title] Found cached title:', title);
      return c.json({ title });
    } else {
      console.log(
        '[POST /convos/gen_title] No title found in cache after retry for:',
        conversationId,
      );
      return c.json(
        {
          message: "Title not found or method not implemented for the conversation's endpoint",
        },
        404,
      );
    }
  } catch (error) {
    console.error('[POST /convos/gen_title] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
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

    const updateData = await c.req.json();
    const { conversationId, ...updates } = updateData.arg || updateData;

    if (!conversationId) {
      return c.json({ error: 'conversationId is required' }, 400);
    }

    console.log('[POST /convos/update] Updating conversation:', conversationId);

    // Update conversation in database
    const conversationRepo = new ConversationRepository(c.env.DB);
    const updatedConversation = await conversationRepo.update(
      conversationId,
      oidcUser.sub,
      updates,
    );

    if (!updatedConversation) {
      return c.json({ error: 'Conversation not found or update failed' }, 404);
    }

    // Validate updated conversation conforms to schema
    const validationResult = tConversationSchema.safeParse(updatedConversation);
    if (!validationResult.success) {
      console.warn('[updateConversation] Conversation validation warning:', {
        conversationId: updatedConversation.conversationId,
        errors: validationResult.error.errors,
      });
      // Return the conversation anyway but log the validation issue
      return c.json(updatedConversation);
    }

    return c.json(validationResult.data);
  } catch (error) {
    console.error('[updateConversation] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Handler for POST /api/convos/clear
 * Clears/deletes a conversation via POST (LibreChat compatibility)
 */
export async function clearConversation(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const requestData = await c.req.json();
    const { conversationId, source } = requestData.arg;

    console.log('[POST /convos/clear] Clear request:', { conversationId, source });

    if (!conversationId) {
      return c.json({ error: 'conversationId is required' }, 400);
    }

    // Handle special case where source is 'button' but no conversationId (matches LibreChat behavior)
    if (source === 'button' && !conversationId) {
      return c.json({ message: 'No conversationId provided' }, 200);
    }

    console.log('[POST /convos/clear] Clearing conversation:', conversationId);

    // Initialize repository and delete conversation
    const conversationRepo = new ConversationRepository(c.env.DB);
    const result = await conversationRepo.delete(conversationId, oidcUser.sub);

    if (!result) {
      return c.json({ error: 'Conversation not found or deletion failed' }, 404);
    }

    return c.json({ message: 'Conversation cleared successfully' });
  } catch (error) {
    console.error('[POST /convos/clear] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
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

    const requestData = await c.req.json();
    const { conversationId, source } = requestData.arg || requestData;

    console.log('[DELETE /convos] Delete request:', { conversationId, source });

    if (!conversationId) {
      return c.json({ error: 'conversationId is required' }, 400);
    }

    // Handle special case where source is 'button' but no conversationId (matches LibreChat behavior)
    if (source === 'button' && !conversationId) {
      return c.json({ message: 'No conversationId provided' }, 200);
    }

    console.log('[DELETE /convos] Deleting conversation:', conversationId);

    // Delete specific conversation
    const conversationRepo = new ConversationRepository(c.env.DB);
    const deleted = await conversationRepo.delete(conversationId, oidcUser.sub);

    if (!deleted) {
      return c.json({ error: 'Conversation not found or deletion failed' }, 404);
    }

    return c.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    console.error('[deleteConversations] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
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

    console.log('[DELETE /convos/all] Deleting all conversations for user:', oidcUser.sub);

    const conversationRepo = new ConversationRepository(c.env.DB);
    const deletedCount = await conversationRepo.deleteAllByUser(oidcUser.sub);

    return c.json({ message: `${deletedCount} conversations deleted successfully` });
  } catch (error) {
    console.error('[deleteAllConversations] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}
