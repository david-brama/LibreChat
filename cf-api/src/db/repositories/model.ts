import { Model, ModelRow, CreateModelDTO, UpdateModelDTO } from '../../types';

/**
 * Repository class for handling model data operations with D1 database
 * Manages AI model configurations and capabilities
 */
export class ModelRepository {
  constructor(private db: D1Database) {}

  /**
   * Creates a new model in the database
   * @param data Model data to create
   * @returns Promise<Model> The created model
   */
  async create(data: CreateModelDTO): Promise<Model> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `
        INSERT INTO models (
          name, model_id, endpoint_type, thinking, context_window, max_output,
          knowledge_cutoff, input_price_per_mtok, output_price_per_mtok, is_active,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .bind(
        data.name,
        data.modelId,
        data.endpointType,
        data.thinking ?? false,
        data.contextWindow,
        data.maxOutput,
        data.knowledgeCutoff || null,
        data.inputPricePerMtok,
        data.outputPricePerMtok,
        data.isActive ?? true,
        now,
        now,
      )
      .run();

    const model = await this.findByModelId(data.modelId);
    if (!model) {
      throw new Error('Failed to create model');
    }
    return model;
  }

  /**
   * Finds a model by its database ID
   * @param id Database ID of the model
   * @returns Promise<Model | null> The found model or null
   */
  async findById(id: number): Promise<Model | null> {
    const result = await this.db
      .prepare('SELECT * FROM models WHERE id = ?')
      .bind(id)
      .first<ModelRow>();

    return result ? this.mapRowToModel(result) : null;
  }

  /**
   * Finds a model by its model ID (API identifier)
   * @param modelId API model identifier (e.g., "claude-sonnet-4-20250514")
   * @returns Promise<Model | null> The found model or null
   */
  async findByModelId(modelId: string): Promise<Model | null> {
    const result = await this.db
      .prepare('SELECT * FROM models WHERE model_id = ?')
      .bind(modelId)
      .first<ModelRow>();

    return result ? this.mapRowToModel(result) : null;
  }

  /**
   * Gets all active models for a specific endpoint type
   * @param endpointType The endpoint type ("openAI" or "anthropic")
   * @returns Promise<Model[]> Array of active models for the endpoint
   */
  async findByEndpointType(endpointType: 'openAI' | 'anthropic'): Promise<Model[]> {
    const results = await this.db
      .prepare('SELECT * FROM models WHERE endpoint_type = ? AND is_active = ? ORDER BY name')
      .bind(endpointType, true)
      .all<ModelRow>();

    return (results.results || []).map((row) => this.mapRowToModel(row));
  }

  /**
   * Gets all active models grouped by endpoint type
   * @returns Promise<{anthropic: Model[], openAI: Model[]}> Models grouped by endpoint
   */
  async findAllActiveGrouped(): Promise<{ anthropic: Model[]; openAI: Model[] }> {
    const results = await this.db
      .prepare('SELECT * FROM models WHERE is_active = ? ORDER BY endpoint_type, name')
      .bind(true)
      .all<ModelRow>();

    const models = (results.results || []).map((row) => this.mapRowToModel(row));

    return {
      anthropic: models.filter((model) => model.endpointType === 'anthropic'),
      openAI: models.filter((model) => model.endpointType === 'openAI'),
    };
  }

  /**
   * Gets all models (active and inactive)
   * @returns Promise<Model[]> Array of all models
   */
  async findAll(): Promise<Model[]> {
    const results = await this.db
      .prepare('SELECT * FROM models ORDER BY endpoint_type, name')
      .all<ModelRow>();

    return (results.results || []).map((row) => this.mapRowToModel(row));
  }

  /**
   * Updates a model by its database ID
   * @param id Database ID of the model to update
   * @param data Update data
   * @returns Promise<Model | null> The updated model or null if not found
   */
  async update(id: number, data: UpdateModelDTO): Promise<Model | null> {
    const updateFields: string[] = [];
    const bindings: any[] = [];

    if (data.name !== undefined) {
      updateFields.push('name = ?');
      bindings.push(data.name);
    }

    if (data.modelId !== undefined) {
      updateFields.push('model_id = ?');
      bindings.push(data.modelId);
    }

    if (data.endpointType !== undefined) {
      updateFields.push('endpoint_type = ?');
      bindings.push(data.endpointType);
    }

    if (data.thinking !== undefined) {
      updateFields.push('thinking = ?');
      bindings.push(data.thinking);
    }

    if (data.contextWindow !== undefined) {
      updateFields.push('context_window = ?');
      bindings.push(data.contextWindow);
    }

    if (data.maxOutput !== undefined) {
      updateFields.push('max_output = ?');
      bindings.push(data.maxOutput);
    }

    if (data.knowledgeCutoff !== undefined) {
      updateFields.push('knowledge_cutoff = ?');
      bindings.push(data.knowledgeCutoff);
    }

    if (data.inputPricePerMtok !== undefined) {
      updateFields.push('input_price_per_mtok = ?');
      bindings.push(data.inputPricePerMtok);
    }

    if (data.outputPricePerMtok !== undefined) {
      updateFields.push('output_price_per_mtok = ?');
      bindings.push(data.outputPricePerMtok);
    }

    if (data.isActive !== undefined) {
      updateFields.push('is_active = ?');
      bindings.push(data.isActive);
    }

    if (updateFields.length === 0) {
      // No fields to update, just return the existing model
      return this.findById(id);
    }

    // Always update the updated_at timestamp
    updateFields.push('updated_at = ?');
    bindings.push(new Date().toISOString());

    // Add WHERE clause binding
    bindings.push(id);

    const query = `
      UPDATE models 
      SET ${updateFields.join(', ')} 
      WHERE id = ?
    `;

    await this.db
      .prepare(query)
      .bind(...bindings)
      .run();

    return this.findById(id);
  }

  /**
   * Deletes a model by its database ID
   * @param id Database ID of the model to delete
   * @returns Promise<boolean> True if deleted, false if not found
   */
  async delete(id: number): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM models WHERE id = ?').bind(id).run();

    return (result.meta.changes || 0) > 0;
  }

  /**
   * Maps a database row to a Model object
   * @param row Database row from models table
   * @returns Model object
   */
  private mapRowToModel(row: ModelRow): Model {
    return {
      id: row.id,
      name: row.name,
      modelId: row.model_id,
      endpointType: row.endpoint_type as 'openAI' | 'anthropic',
      thinking: Boolean(row.thinking),
      contextWindow: row.context_window,
      maxOutput: row.max_output,
      knowledgeCutoff: row.knowledge_cutoff,
      inputPricePerMtok: row.input_price_per_mtok,
      outputPricePerMtok: row.output_price_per_mtok,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
