import { Hono } from 'hono';
import { getUserKey } from './handlers';

/**
 * Keys routes for /api/keys
 * Handles user API key management
 */
const keys = new Hono();

// GET /api/keys?name=endpoint - Check if user has provided API key for endpoint
keys.get('/', getUserKey);

export default keys;
