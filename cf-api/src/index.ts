import { Hono, OidcAuthClaims } from 'hono';
import {
  oidcAuthMiddleware,
  revokeSession,
  processOAuthCallback,
  OidcAuth,
  IDToken,
  TokenEndpointResponses,
} from '@hono/oidc-auth';
import api from './api';

const app = new Hono<{ Bindings: CloudflareBindings }>();

declare module 'hono' {
  interface OidcAuthClaims {
    name: string;
    sub: string;
  }
}

const oidcClaimsHook = async (
  orig: OidcAuth | undefined,
  claims: IDToken | undefined,
  _response: TokenEndpointResponses,
): Promise<OidcAuthClaims> => {
  return {
    name: (claims?.name as string) ?? orig?.name ?? '',
    sub: claims?.sub ?? orig?.sub ?? '',
  };
};

app.get('/logout', async (c) => {
  await revokeSession(c);
  c.env.ANTHROPIC_API_KEY;
  return c.text('Logged out', 200);
});

app.get('/callback', async (c) => {
  c.set('oidcClaimsHook', oidcClaimsHook);
  await processOAuthCallback(c);
  return c.redirect('/');
});

app.use('/api/*', oidcAuthMiddleware());
app.route('/api', api);

export default app;
