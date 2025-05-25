import { Hono } from 'hono';
import { getAuth } from '@hono/oidc-auth';

const agents = new Hono<{ Bindings: CloudflareBindings }>();

/**
 * GET /api/agents/tools/calls
 * Retrieves tool calls for a specific conversation
 * Used by LibreChat frontend to load agent tool call history
 *
 * For MVP: Returns empty array since we don't have agent tools implemented
 * Future: Will return actual tool calls from database
 */
agents.get('/tools/calls', async (c) => {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Get conversation ID from query parameters
    const conversationId = c.req.query('conversationId');

    console.log('[GET /api/agents/tools/calls] Tool calls requested:', {
      userId: oidcUser.sub,
      conversationId,
    });

    // For MVP: Return empty array since we don't have agent tools
    // In the future, this would query a tool_calls table or similar
    const toolCalls: any[] = [];

    console.log('[GET /api/agents/tools/calls] Returning tool calls:', {
      conversationId,
      toolCallCount: toolCalls.length,
    });

    return c.json(toolCalls);
  } catch (error) {
    console.error('[GET /api/agents/tools/calls] Error retrieving tool calls:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/agents/tools/auth
 * Returns authentication status for agent tools
 * For MVP: Always returns not authenticated since we don't have tools
 */
agents.get('/tools/auth', async (c) => {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    console.log('[GET /api/agents/tools/auth] Tool auth status requested:', {
      userId: oidcUser.sub,
    });

    // For MVP: Return not authenticated for all tools
    return c.json({
      web_search: false,
      execute_code: false,
    });
  } catch (error) {
    console.error('[GET /api/agents/tools/auth] Error checking tool auth:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/agents
 * Returns available agents
 * For MVP: Returns empty array since we don't have agents
 */
agents.get('/', async (c) => {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    console.log('[GET /api/agents] Agents list requested:', {
      userId: oidcUser.sub,
    });

    // For MVP: Return empty array since we don't have agents implemented
    const agents: any[] = [];

    return c.json(agents);
  } catch (error) {
    console.error('[GET /api/agents] Error retrieving agents:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default agents;
