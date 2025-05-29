import { Context } from 'hono';

/**
 * Helper function to create standardized unauthorized responses
 * Returns appropriate response format based on request type (API vs browser)
 *
 * @param c - Hono context
 * @returns Response with appropriate format for API or browser requests
 */
export const createUnauthorizedResponse = (c: Context<{ Bindings: CloudflareBindings }>) => {
  // Check if this is an API request (Content-Type or Accept headers indicate JSON)
  const contentType = c.req.header('Content-Type');
  const acceptHeader = c.req.header('Accept');
  const isApiRequest =
    contentType?.includes('application/json') || acceptHeader?.includes('application/json');

  if (isApiRequest) {
    // For API requests, return JSON response to allow client-side redirect handling
    return c.json({ error: 'Authentication required', redirect: '/login' }, 401);
  } else {
    // For browser requests, redirect directly
    return c.redirect('/login');
  }
};
