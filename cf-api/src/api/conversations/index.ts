import { Hono } from 'hono';
import { getAuth } from '@hono/oidc-auth';
import { ConversationRepository } from '../../db/repositories/conversation';
import type { ConversationListParams, ConversationListResponse } from '../../types';
import {
  listConversations,
  getConversation,
  updateConversation,
  deleteConversations,
  deleteAllConversations,
} from './handlers';

/**
 * Conversation routes for /api/convos
 * Handles conversation CRUD operations
 */
const conversations = new Hono<{ Bindings: CloudflareBindings }>();

// GET /api/convos - List conversations with pagination and filtering
conversations.get('/', async (c) => {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Parse query parameters
    const params: ConversationListParams = {
      cursor: c.req.query('cursor') || undefined,
      limit: parseInt(c.req.query('limit') || '20'),
      isArchived: c.req.query('isArchived') === 'true',
      tags: c.req.queries('tags[]') || undefined,
      search: c.req.query('search') || undefined,
      order: (c.req.query('order') as 'asc' | 'desc') || 'desc',
    };

    console.log('[GET /convos] Request params:', params);

    // Initialize repository and fetch conversations
    const conversationRepository = new ConversationRepository(c.env.DB);
    const result: ConversationListResponse = await conversationRepository.findByUser(
      oidcUser.sub,
      params,
    );

    return c.json(result);
  } catch (error) {
    console.error('[GET /convos] Error fetching conversations:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /api/convos/:id - Get specific conversation
conversations.get('/:id', async (c) => {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const conversationId = c.req.param('id');
    console.log('[GET /convos/:id] Fetching conversation:', conversationId);

    // Initialize repository and fetch conversation
    const conversationRepository = new ConversationRepository(c.env.DB);
    const conversation = await conversationRepository.findByIdAndUser(conversationId, oidcUser.sub);

    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    return c.json(conversation);
  } catch (error) {
    console.error('[GET /convos/:id] Error fetching conversation:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /api/convos/gen_title - Generate conversation title
conversations.post('/gen_title', async (c) => {
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
});

// POST /api/convos/update - Update conversation
conversations.post('/update', async (c) => {
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

    // Initialize repository and update conversation
    const conversationRepository = new ConversationRepository(c.env.DB);
    const updatedConversation = await conversationRepository.update(
      conversationId,
      oidcUser.sub,
      updates,
    );

    if (!updatedConversation) {
      return c.json({ error: 'Conversation not found or update failed' }, 404);
    }

    return c.json(updatedConversation);
  } catch (error) {
    console.error('[POST /convos/update] Error updating conversation:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// DELETE /api/convos - Delete conversation(s)
conversations.delete('/', async (c) => {
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

    // Initialize repository and delete conversation
    const conversationRepository = new ConversationRepository(c.env.DB);
    const result = await conversationRepository.delete(conversationId, oidcUser.sub);

    if (!result) {
      return c.json({ error: 'Conversation not found or deletion failed' }, 404);
    }

    return c.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    console.error('[DELETE /convos] Error deleting conversation:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// DELETE /api/convos/all - Delete all conversations for user
conversations.delete('/all', async (c) => {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    console.log('[DELETE /convos/all] Deleting all conversations for user:', oidcUser.sub);

    // Initialize repository and delete all conversations
    const conversationRepository = new ConversationRepository(c.env.DB);
    const result = await conversationRepository.deleteAllByUser(oidcUser.sub);

    return c.json({ message: `${result} conversations deleted successfully` });
  } catch (error) {
    console.error('[DELETE /convos/all] Error deleting all conversations:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default conversations;
