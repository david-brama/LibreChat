import { Hono } from 'hono';

/**
 * Models routes for /api/models
 * Provides available AI models for each endpoint
 */
const files = new Hono();

// GET /api/models - Get available models for all endpoints
files.get('/', (c) => {
  return c.body(null, 200);
});
files.get('/config', (c) => {
  return c.body(null, 200);
});

export default files;
