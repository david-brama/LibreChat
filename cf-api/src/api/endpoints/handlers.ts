import { Context } from 'hono';
import { EndpointsConfig } from '../../types';
import { ModelRepository } from '../../db/repositories/model';

/**
 * Handler for GET /api/endpoints
 * Returns the available AI endpoints configuration for the frontend
 *
 * Only includes endpoints that have BOTH:
 * - A configured API key
 * - At least one active model in the database
 */
export async function getEndpoints(c: Context) {
  try {
    // Check if API keys are available
    const hasAnthropic = !!c.env.ANTHROPIC_API_KEY;
    const hasOpenAI = !!c.env.OPENAI_API_KEY;

    if (!hasAnthropic && !hasOpenAI) {
      console.error('[getEndpoints] No API keys configured');
      return c.json({ error: 'No API keys configured' }, 500);
    }

    // Check available models from database
    const modelRepository = new ModelRepository(c.env.DB);
    const modelGroups = await modelRepository.findAllActiveGrouped();

    // Configuration with available endpoints - only include endpoints with both API keys AND models
    const endpointsConfig: EndpointsConfig = {};
    let orderIndex = 0;

    // Only include Anthropic if we have both API key and active models
    if (hasAnthropic && modelGroups.anthropic.length > 0) {
      endpointsConfig.anthropic = {
        order: orderIndex++,
        type: 'anthropic',
        userProvide: false,
        userProvideURL: false,
      };
      console.log(
        `[getEndpoints] Including Anthropic endpoint with ${modelGroups.anthropic.length} models`,
      );
    } else if (hasAnthropic && modelGroups.anthropic.length === 0) {
      console.warn('[getEndpoints] Anthropic API key available but no active models in database');
    }

    // Only include OpenAI if we have both API key and active models
    if (hasOpenAI && modelGroups.openAI.length > 0) {
      endpointsConfig.openAI = {
        order: orderIndex++,
        type: 'openAI',
        userProvide: false,
        userProvideURL: false,
      };
      console.log(
        `[getEndpoints] Including OpenAI endpoint with ${modelGroups.openAI.length} models`,
      );
    } else if (hasOpenAI && modelGroups.openAI.length === 0) {
      console.warn('[getEndpoints] OpenAI API key available but no active models in database');
    }

    // Ensure we have at least one endpoint available
    const totalEndpoints = Object.keys(endpointsConfig).length;
    if (totalEndpoints === 0) {
      console.error(
        '[getEndpoints] No endpoints available - either missing API keys or no active models',
      );
      return c.json(
        { error: 'No endpoints available - check API keys and database configuration' },
        503,
      );
    }

    console.log('[getEndpoints] Successfully serving endpoints:', Object.keys(endpointsConfig));

    return c.json(endpointsConfig);
  } catch (error) {
    console.error('[getEndpoints] Error:', error);
    return c.json({ error: 'Error fetching endpoints configuration' }, 500);
  }
}
