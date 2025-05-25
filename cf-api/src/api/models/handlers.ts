import { Context } from 'hono';
import { ModelsConfig } from '../../types';

/**
 * Handler for GET /api/models
 * Returns the available models for each endpoint
 *
 * For MVP: Only supports claude-sonnet-4-20250514 on Anthropic endpoint
 */
export async function getModels(c: Context) {
  try {
    // Check if Anthropic API key is available
    if (!c.env.ANTHROPIC_API_KEY) {
      console.error('[getModels] ANTHROPIC_API_KEY not configured');
      return c.json({ error: 'Anthropic API key not configured' }, 500);
    }

    // MVP configuration with only Claude Sonnet 4.0
    const modelsConfig: ModelsConfig = {
      anthropic: ['claude-sonnet-4-20250514'], // MVP single model as specified
    };

    return c.json(modelsConfig);
  } catch (error) {
    console.error('[getModels] Error:', error);
    return c.json({ error: 'Error fetching models configuration' }, 500);
  }
}
