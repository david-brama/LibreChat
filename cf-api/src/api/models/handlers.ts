import { Context } from 'hono';
import { ModelsConfig } from '../../types';
import { ModelRepository } from '../../db/repositories/model';

/**
 * Handler for GET /api/models
 * Returns the available models for each endpoint from the database
 *
 * Only includes endpoints that have BOTH:
 * - A configured API key
 * - At least one active model in the database
 *
 * Returns 503 if no endpoints meet both criteria
 */
export async function getModels(c: Context) {
  try {
    // Check if API keys are available
    const hasAnthropic = !!c.env.ANTHROPIC_API_KEY;
    const hasOpenAI = !!c.env.OPENAI_API_KEY;

    if (!hasAnthropic && !hasOpenAI) {
      console.error('[getModels] No API keys configured');
      return c.json({ error: 'No API keys configured' }, 500);
    }

    // Initialize repository and fetch models from database
    const modelRepository = new ModelRepository(c.env.DB);
    const modelGroups = await modelRepository.findAllActiveGrouped();

    // Configuration with available models - only include endpoints with both API keys AND models
    const modelsConfig: ModelsConfig = {};

    // Only include Anthropic if we have both API key and active models
    if (hasAnthropic && modelGroups.anthropic.length > 0) {
      modelsConfig.anthropic = modelGroups.anthropic.map((model) => model.modelId);
      console.log(`[getModels] Serving ${modelGroups.anthropic.length} Anthropic models`);
    } else if (hasAnthropic && modelGroups.anthropic.length === 0) {
      console.warn('[getModels] Anthropic API key available but no active models in database');
    }

    // Only include OpenAI if we have both API key and active models
    if (hasOpenAI && modelGroups.openAI.length > 0) {
      modelsConfig.openAI = modelGroups.openAI.map((model) => model.modelId);
      console.log(`[getModels] Serving ${modelGroups.openAI.length} OpenAI models`);
    } else if (hasOpenAI && modelGroups.openAI.length === 0) {
      console.warn('[getModels] OpenAI API key available but no active models in database');
    }

    // Ensure we have at least one endpoint with models before returning
    const totalEndpoints = Object.keys(modelsConfig).length;
    if (totalEndpoints === 0) {
      console.error(
        '[getModels] No endpoints available - either missing API keys or no active models',
      );
      return c.json(
        { error: 'No models available - check API keys and database configuration' },
        503,
      );
    }

    console.log('[getModels] Successfully serving models:', {
      endpoints: Object.keys(modelsConfig),
      totalModels: Object.values(modelsConfig).flat().length,
    });

    return c.json(modelsConfig);
  } catch (error) {
    console.error('[getModels] Error:', error);
    return c.json({ error: 'Error fetching models configuration' }, 500);
  }
}
