import { Hono } from 'hono';
import { getEndpoints } from './handlers';

/**
 * Endpoints routes for /api/endpoints
 * Provides AI endpoint configuration for the frontend
 */
const endpoints = new Hono();

// GET /api/endpoints - Get available AI endpoints configuration
endpoints.get('/', getEndpoints);

export default endpoints;
