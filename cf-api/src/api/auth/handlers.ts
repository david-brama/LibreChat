import { Context } from 'hono';
import { getAuth, revokeSession } from '@hono/oidc-auth';
import { TUser } from 'librechat-data-provider';

/**
 * Handler for POST /api/auth/refresh
 * Refreshes the authentication token and returns user information
 *
 * This endpoint is called by the LibreChat frontend to validate
 * the current session and retrieve updated user information.
 */
export async function refreshAuth(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    const oidcUser = await getAuth(c);
    if (oidcUser === null) {
      return c.json(null);
    }

    const user: TUser = {
      id: oidcUser.sub,
      name: oidcUser.name,
      email: oidcUser.email as string,
      username: oidcUser.name,
      avatar: '',
      role: '',
      provider: 'Microsoft',
      createdAt: '',
      updatedAt: '',
    };

    return c.json({ token: 'demo', user });
  } catch (error) {
    console.error('[refreshAuth] Error:', error);
    return c.json({ error: 'Error refreshing authentication' }, 500);
  }
}

/**
 * Handler for POST /api/auth/logout
 * Logs out the current user by revoking their session
 *
 * This endpoint is called when the user clicks the logout button
 * in the LibreChat frontend. It revokes the OIDC session.
 */
export async function logout(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    await revokeSession(c);
    return c.json(null);
  } catch (error) {
    console.error('[logout] Error:', error);
    return c.json({ error: 'Error during logout' }, 500);
  }
}
