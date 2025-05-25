import { Hono } from 'hono';
import { getModels } from './handlers';

/**
 * Models routes for /api/models
 * Provides available AI models for each endpoint
 */
const models = new Hono();

// GET /api/models - Get available models for all endpoints
models.get('/', getModels);

export default models;
