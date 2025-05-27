import { Hono } from 'hono';
import { getAuth } from '@hono/oidc-auth';
import { ModelRepository } from '../../db/repositories/model';
import { CreateModelDTO, UpdateModelDTO } from '../../types';

/**
 * Admin routes for model management
 * Provides CRUD operations for the models table
 * Restricted to authenticated users (add admin checks as needed)
 */
const models = new Hono<{ Bindings: CloudflareBindings }>();

/**
 * GET /api/admin/models
 * List all models (active and inactive)
 */
models.get('/', async (c) => {
  try {
    // Verify authentication
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // TODO: Add admin role check here
    // if (!isAdmin(oidcUser)) {
    //   return c.json({ error: 'Forbidden - Admin access required' }, 403);
    // }

    const modelRepository = new ModelRepository(c.env.DB);
    const models = await modelRepository.findAll();

    return c.json({ models });
  } catch (error) {
    console.error('[GET /api/admin/models] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/admin/models/:id
 * Get a specific model by ID
 */
models.get('/:id', async (c) => {
  try {
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ error: 'Invalid model ID' }, 400);
    }

    const modelRepository = new ModelRepository(c.env.DB);
    const model = await modelRepository.findById(id);

    if (!model) {
      return c.json({ error: 'Model not found' }, 404);
    }

    return c.json({ model });
  } catch (error) {
    console.error('[GET /api/admin/models/:id] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/admin/models
 * Create a new model
 */
models.post('/', async (c) => {
  try {
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body: CreateModelDTO = await c.req.json();

    // Validate required fields
    if (
      !body.name ||
      !body.modelId ||
      !body.endpointType ||
      !body.contextWindow ||
      !body.maxOutput
    ) {
      return c.json(
        {
          error: 'Missing required fields: name, modelId, endpointType, contextWindow, maxOutput',
        },
        400,
      );
    }

    if (!['openAI', 'anthropic'].includes(body.endpointType)) {
      return c.json({ error: 'endpointType must be either "openAI" or "anthropic"' }, 400);
    }

    if (body.inputPricePerMtok === undefined || body.outputPricePerMtok === undefined) {
      return c.json(
        { error: 'Missing required pricing fields: inputPricePerMtok, outputPricePerMtok' },
        400,
      );
    }

    const modelRepository = new ModelRepository(c.env.DB);

    // Check if model ID already exists
    const existingModel = await modelRepository.findByModelId(body.modelId);
    if (existingModel) {
      return c.json({ error: 'Model ID already exists' }, 409);
    }

    const model = await modelRepository.create(body);

    console.log('[POST /api/admin/models] Model created:', {
      id: model.id,
      name: model.name,
      modelId: model.modelId,
      endpointType: model.endpointType,
    });

    return c.json({ model }, 201);
  } catch (error) {
    console.error('[POST /api/admin/models] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * PUT /api/admin/models/:id
 * Update an existing model
 */
models.put('/:id', async (c) => {
  try {
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ error: 'Invalid model ID' }, 400);
    }

    const body: UpdateModelDTO = await c.req.json();

    if (body.endpointType && !['openAI', 'anthropic'].includes(body.endpointType)) {
      return c.json({ error: 'endpointType must be either "openAI" or "anthropic"' }, 400);
    }

    const modelRepository = new ModelRepository(c.env.DB);

    // Check if model exists
    const existingModel = await modelRepository.findById(id);
    if (!existingModel) {
      return c.json({ error: 'Model not found' }, 404);
    }

    // Check if new model ID conflicts with existing model
    if (body.modelId && body.modelId !== existingModel.modelId) {
      const conflictingModel = await modelRepository.findByModelId(body.modelId);
      if (conflictingModel) {
        return c.json({ error: 'Model ID already exists' }, 409);
      }
    }

    const model = await modelRepository.update(id, body);

    if (!model) {
      return c.json({ error: 'Failed to update model' }, 500);
    }

    console.log('[PUT /api/admin/models/:id] Model updated:', {
      id: model.id,
      name: model.name,
      modelId: model.modelId,
      changes: Object.keys(body),
    });

    return c.json({ model });
  } catch (error) {
    console.error('[PUT /api/admin/models/:id] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * DELETE /api/admin/models/:id
 * Delete a model
 */
models.delete('/:id', async (c) => {
  try {
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ error: 'Invalid model ID' }, 400);
    }

    const modelRepository = new ModelRepository(c.env.DB);

    // Check if model exists
    const existingModel = await modelRepository.findById(id);
    if (!existingModel) {
      return c.json({ error: 'Model not found' }, 404);
    }

    const deleted = await modelRepository.delete(id);

    if (!deleted) {
      return c.json({ error: 'Failed to delete model' }, 500);
    }

    console.log('[DELETE /api/admin/models/:id] Model deleted:', {
      id,
      name: existingModel.name,
      modelId: existingModel.modelId,
    });

    return c.json({ message: 'Model deleted successfully' });
  } catch (error) {
    console.error('[DELETE /api/admin/models/:id] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/admin/models/populate
 * Populate the models table with default configurations
 * This is equivalent to running the populate-models script
 */
models.post('/populate', async (c) => {
  try {
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const modelRepository = new ModelRepository(c.env.DB);

    // Default models to populate (same as in the script)
    const defaultModels: CreateModelDTO[] = [
      {
        name: 'Sonnet 4',
        modelId: 'claude-sonnet-4-20250514',
        endpointType: 'anthropic',
        thinking: true,
        contextWindow: 200000,
        maxOutput: 64000,
        knowledgeCutoff: '2025-03-01T00:00:00Z',
        inputPricePerMtok: 3,
        outputPricePerMtok: 15,
        isActive: true,
      },
      {
        name: 'GPT-4.1',
        modelId: 'gpt-4.1',
        endpointType: 'openAI',
        thinking: false,
        contextWindow: 128000,
        maxOutput: 4096,
        knowledgeCutoff: '2024-10-01T00:00:00Z',
        inputPricePerMtok: 10,
        outputPricePerMtok: 30,
        isActive: true,
      },
      {
        name: 'GPT-4.1 Nano',
        modelId: 'gpt-4.1-nano',
        endpointType: 'openAI',
        thinking: false,
        contextWindow: 32000,
        maxOutput: 2048,
        knowledgeCutoff: '2024-10-01T00:00:00Z',
        inputPricePerMtok: 2,
        outputPricePerMtok: 8,
        isActive: true,
      },
    ];

    const results = [];
    let created = 0;
    let skipped = 0;

    for (const modelData of defaultModels) {
      try {
        // Check if model already exists
        const existing = await modelRepository.findByModelId(modelData.modelId);
        if (existing) {
          results.push({
            modelId: modelData.modelId,
            status: 'skipped',
            reason: 'already exists',
          });
          skipped++;
          continue;
        }

        const model = await modelRepository.create(modelData);
        results.push({
          modelId: modelData.modelId,
          status: 'created',
          id: model.id,
        });
        created++;
      } catch (error) {
        results.push({
          modelId: modelData.modelId,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    console.log('[POST /api/admin/models/populate] Population completed:', {
      created,
      skipped,
      total: defaultModels.length,
    });

    return c.json({
      message: 'Model population completed',
      summary: { created, skipped, total: defaultModels.length },
      results,
    });
  } catch (error) {
    console.error('[POST /api/admin/models/populate] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default models;
