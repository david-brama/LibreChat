import { getAuth, oidcAuthMiddleware } from '@hono/oidc-auth';
import { Hono } from 'hono';
import conversations from './conversations';
import endpoints from './endpoints';
import models from './models';
import keys from './keys';
import dummy from './dummy';
import ask from './ask';
import messages from './messages';
import agents from './agents';
import edit from './edit';
import config from './config';
import banner from './banner';
import auth from './auth';
import adminModels from './admin/models';

const api = new Hono<{ Bindings: CloudflareBindings }>();

// Middleware to protect authenticated routes
api.use('/:resource/*', (c, next) => {
  const resource = c.req.param('resource');
  if (resource === 'config' || resource === 'banner' || resource === 'auth') {
    return next();
  }
  return oidcAuthMiddleware()(c, next);
});

// Mount config routes
api.route('/config', config);

// Mount banner routes
api.route('/banner', banner);

// Mount auth routes
api.route('/auth', auth);

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

api.use('/admin/*', async (c, next) => {
  const oidcUser = await getAuth(c);
  const adminGroup = c.env.ADMIN_GROUPID;
  if (
    !oidcUser ||
    !oidcUser.groups ||
    !(oidcUser.groups as string[]).includes(adminGroup as string)
  ) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});
// Mount admin routes for model management
api.route('/admin/models', adminModels);

export default api;
