import { Context } from 'hono';
import { EndpointsConfig } from '../../types';

/**
 * Handler for GET /api/endpoints
 * Returns the available AI endpoints configuration for the frontend
 *
 * For MVP: Only supports Anthropic Claude Sonnet 4.0 with default configuration
 */
export async function getEndpoints(c: Context) {
  try {
    // MVP configuration with only Anthropic support
    const endpointsConfig: EndpointsConfig = {
      anthropic: {
        order: 0, // First and only endpoint
        type: 'anthropic', // Endpoint type
        userProvide: false, // API key is provided by the server
        userProvideURL: false, // Using default Anthropic API URL
      },
    };

    return c.json(endpointsConfig);
  } catch (error) {
    console.error('[getEndpoints] Error:', error);
    return c.json({ error: 'Error fetching endpoints configuration' }, 500);
  }
}
