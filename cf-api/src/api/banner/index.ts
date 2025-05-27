import { Hono } from 'hono';
import { getBanner } from './handlers';

/**
 * Banner routes for /api/banner
 * Provides banner configuration for the frontend
 */
const banner = new Hono();

// GET /api/banner - Get banner configuration
banner.get('/', getBanner);

export default banner;
