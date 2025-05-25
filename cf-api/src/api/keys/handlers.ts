import { Context } from 'hono';
import { getAuth } from '@hono/oidc-auth';

/**
 * Response type for user key query
 */
interface UserKeyResponse {
  expiresAt: string | null;
}

/**
 * Handler for GET /api/keys?name=anthropic
 * Checks if a user has provided their own API key for a specific endpoint
 *
 * For MVP: Since we don't support user-provided keys (userProvide: false),
 * this always returns null indicating no user key is stored
 */
export async function getUserKey(c: Context) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const name = c.req.query('name');
    if (!name) {
      return c.json({ error: 'Key name is required' }, 400);
    }

    // For MVP: We don't support user-provided keys
    // Always return null since server provides all API keys
    const response: UserKeyResponse = {
      expiresAt: null,
    };

    return c.json(response);
  } catch (error) {
    console.error('[getUserKey] Error:', error);
    return c.json({ error: 'Error checking user key' }, 500);
  }
}
