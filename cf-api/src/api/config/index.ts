import { Hono } from 'hono';
import { getConfig } from './handlers';

/**
 * Config routes for /api/config
 * Provides LibreChat configuration for the frontend
 */
const config = new Hono();

// GET /api/config - Get LibreChat startup configuration
config.get('/', getConfig);

export default config;
