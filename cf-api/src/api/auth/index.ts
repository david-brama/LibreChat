import { Hono } from 'hono';
import { refreshAuth, logout } from './handlers';

/**
 * Auth routes for /api/auth
 * Provides authentication and user management endpoints
 */
const auth = new Hono<{ Bindings: CloudflareBindings }>();

// POST /api/auth/refresh - Refresh authentication token
auth.post('/refresh', refreshAuth);

// POST /api/auth/logout - Logout user
auth.post('/logout', logout);

export default auth;
