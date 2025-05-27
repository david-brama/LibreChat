import { Hono, OidcAuthClaims } from 'hono';
import {
  revokeSession,
  processOAuthCallback,
  OidcAuth,
  IDToken,
  TokenEndpointResponses,
  oidcAuthMiddleware,
} from '@hono/oidc-auth';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
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
  const referer = c.req.header('referer');
  setCookie(c, 'referer', referer ?? '/');
  return oidcAuthMiddleware()(c, next);
});
app.get('/logout', async (c) => {
  await revokeSession(c);
  return c.text('Logged out', 200);
});

app.get('/callback', async (c) => {
  c.set('oidcClaimsHook', oidcClaimsHook);
  await processOAuthCallback(c);
  const referer = getCookie(c, 'referer');
  deleteCookie(c, 'referer');
  return c.redirect(referer ?? '/');
});

app.route('/api', api);

app.get('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
