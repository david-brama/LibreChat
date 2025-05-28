import { Hono, OidcAuthClaims } from 'hono';
import {
  revokeSession,
  processOAuthCallback,
  OidcAuth,
  IDToken,
  TokenEndpointResponses,
  oidcAuthMiddleware,
} from '@hono/oidc-auth';

import api from './api';

const app = new Hono<{ Bindings: CloudflareBindings }>();

declare module 'hono' {
  interface OidcAuthClaims {
    name: string;
    sub: string;
  }
}

app.get('/health', (c) => {
  return c.text('OK', 200);
});

const oidcClaimsHook = async (
  orig: OidcAuth | undefined,
  claims: IDToken | undefined,
  _response: TokenEndpointResponses,
): Promise<OidcAuthClaims> => {
  return {
    name: (claims?.name as string) ?? orig?.name ?? '',
    sub: claims?.sub ?? orig?.sub ?? '',
    exp: new Date().getTime() + 1000 * 60 * 60 * 24 * 14,
    groups: claims?.groups ?? [],
  };
};

app.use('/oauth/openid', (c, next) => {
  return oidcAuthMiddleware()(c, next);
});
app.get('/logout', async (c) => {
  await revokeSession(c);
  return c.text('Logged out', 200);
});

app.get('/callback', async (c) => {
  c.set('oidcClaimsHook', oidcClaimsHook);
  await processOAuthCallback(c);
  return c.redirect('/');
});

app.route('/api', api);

// Fallback handler for static assets
// Only serve static assets for routes that don't start with /api, /oauth, /callback, /logout, /health
app.all('*', async (c) => {
  const pathname = new URL(c.req.url).pathname;

  // Don't serve static assets for API, OAuth, or other Worker-handled routes
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/oauth') ||
    pathname === '/callback' ||
    pathname === '/logout' ||
    pathname === '/health'
  ) {
    // Return 404 for unmatched API/OAuth routes to avoid conflicts
    return c.notFound();
  }

  // Use the ASSETS binding to serve static files
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
