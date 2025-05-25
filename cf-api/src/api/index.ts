import { getAuth } from '@hono/oidc-auth';
import { Hono } from 'hono';
import { TBanner, TStartupConfig, TUser } from 'librechat-data-provider';
import conversations from './conversations';
import endpoints from './endpoints';
import models from './models';
import keys from './keys';
import dummy from './dummy';
import ask from './ask';
import messages from './messages';
import agents from './agents';
import edit from './edit';

const api = new Hono<{ Bindings: CloudflareBindings }>();

api.get('/', (c) => {
  return c.json({ message: 'Hello, World!' });
});

api.get('/config', async (c) => {
  const config: TStartupConfig = {
    appTitle: 'My App',
    discordLoginEnabled: false,
    facebookLoginEnabled: false,
    githubLoginEnabled: false,
    googleLoginEnabled: false,
    openidLoginEnabled: true,
    appleLoginEnabled: false,
    openidLabel: 'Microsoft',
    openidImageUrl: '',
    openidAutoRedirect: false,
    serverDomain: 'localhost',
    emailLoginEnabled: false,
    registrationEnabled: false,
    socialLoginEnabled: false,
    passwordResetEnabled: false,
    emailEnabled: false,
    showBirthdayIcon: false,
    helpAndFaqURL: '',
    sharedLinksEnabled: false,
    publicSharedLinksEnabled: false,
    instanceProjectId: '',
    // Enable model selector interface for MVP
    interface: {
      modelSelect: true,
    },
  };

  return c.json(config);
});

api.get('/banner', async (c) => {
  const banner: TBanner = {
    bannerId: '1',
    message: 'My App Banner',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isPublic: true,
    displayFrom: new Date().toISOString(),
    displayTo: new Date().toISOString(),
  };

  return c.json(banner);
});

api.post('/auth/refresh', async (c) => {
  const oidcUser = await getAuth(c);
  if (oidcUser === null) {
    return c.json({ error: 'Unauthorized' }, 401);
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
});

api.get('/user', async (c) => {
  const user = await getAuth(c);
  return c.json(user);
});

// Mount conversation routes
api.route('/convos', conversations);

// Mount endpoints routes
api.route('/endpoints', endpoints);

// Mount models routes
api.route('/models', models);

// Mount keys routes
api.route('/keys', keys);

// Mount dummy/non-MVP routes
api.route('/', dummy);

// Mount ask routes for chat completion
api.route('/ask', ask);

// Mount messages routes for conversation history
api.route('/messages', messages);

// Mount agents routes for tool calls and agent management
api.route('/agents', agents);

// Mount edit routes for message editing and conversation regeneration
api.route('/edit', edit);

export default api;
