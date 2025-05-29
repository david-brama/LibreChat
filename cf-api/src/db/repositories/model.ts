import { Model, ModelRow, CreateModelDTO, UpdateModelDTO } from '../../types';

/**
 * Repository class for handling model data operations with D1 database
 * Manages AI model configurations and capabilities for modelSpecs
 */
export class ModelRepository {
  constructor(private db: D1Database) {}

  /**
   * Creates a new model in the database with modelSpecs structure
   * @param data Model data to create
   * @returns Promise<Model> The created model
   */
  async create(data: CreateModelDTO): Promise<Model> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `
        INSERT INTO models (
          name, model_id, endpoint_type, thinking, vision, context_window, max_output,
          knowledge_cutoff, input_price_per_mtok, output_price_per_mtok, is_active,
          spec, label, description, icon_url, is_default, sort_order, system_message,
          model_label, prompt_prefix, temperature, top_p, top_k, frequency_penalty,
          presence_penalty, max_tokens, stop_sequences, reasoning_effort, resend_files,
          prompt_cache, thinking_budget, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .bind(
        data.name,
        data.modelId,
        data.endpointType,
        data.thinking ?? false,
        data.vision ?? false,
        data.contextWindow,
        data.maxOutput,
        data.knowledgeCutoff || null,
        data.inputPricePerMtok,
        data.outputPricePerMtok,
        data.isActive ?? true,
        data.spec,
        data.label,
        data.description || null,
        data.iconUrl || null,
        data.isDefault ?? false,
        data.sortOrder ?? 0,
        data.systemMessage || null,
        data.modelLabel || null,
        data.promptPrefix || null,
        data.temperature || null,
        data.topP || null,
        data.topK || null,
        data.frequencyPenalty || null,
        data.presencePenalty || null,
        data.maxTokens || null,
        data.stopSequences ? JSON.stringify(data.stopSequences) : null,
        data.reasoningEffort || null,
        data.resendFiles ?? false,
        data.promptCache ?? false,
        data.thinkingBudget || null,
        now,
        now,
      )
      .run();

    const model = await this.findBySpec(data.spec);
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
   * Finds a model by its spec (unique identifier for modelSpecs)
   * @param spec Spec identifier (e.g., "gpt-generics", "claude-dev")
   * @returns Promise<Model | null> The found model or null
   */
  async findBySpec(spec: string): Promise<Model | null> {
    const result = await this.db
      .prepare('SELECT * FROM models WHERE spec = ?')
      .bind(spec)
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
      .prepare(
        'SELECT * FROM models WHERE endpoint_type = ? AND is_active = ? ORDER BY sort_order, name',
      )
      .bind(endpointType, true)
      .all<ModelRow>();

    return (results.results || []).map((row) => this.mapRowToModel(row));
  }

  /**
   * Gets all active models for a specific endpoint (alias for findByEndpointType)
   * @param endpoint The endpoint name ("openAI" or "anthropic")
   * @returns Promise<Model[]> Array of active models for the endpoint
   */
  async findByEndpoint(endpoint: string): Promise<Model[]> {
    // Map endpoint names to types
    const endpointMap: Record<string, 'openAI' | 'anthropic'> = {
      openAI: 'openAI',
      anthropic: 'anthropic',
    };

    const endpointType = endpointMap[endpoint];
    if (!endpointType) {
      return [];
    }

    return this.findByEndpointType(endpointType);
  }

  /**
   * Gets all active models grouped by endpoint type
   * @returns Promise<{anthropic: Model[], openAI: Model[]}> Models grouped by endpoint
   */
  async findAllActiveGrouped(): Promise<{ anthropic: Model[]; openAI: Model[] }> {
    const results = await this.db
      .prepare('SELECT * FROM models WHERE is_active = ? ORDER BY endpoint_type, sort_order, name')
      .bind(true)
      .all<ModelRow>();

    const models = (results.results || []).map((row) => this.mapRowToModel(row));

    return {
      anthropic: models.filter((model) => model.endpointType === 'anthropic'),
      openAI: models.filter((model) => model.endpointType === 'openAI'),
    };
  }

  /**
   * Gets all models formatted as LibreChat modelSpecs
   * @returns Promise<ModelSpec[]> Array of models in modelSpecs format
   */
  async getModelSpecs(): Promise<
    Array<{
      name: string;
      label: string;
      preset: any;
      default?: boolean;
      description?: string;
      iconURL?: string;
    }>
  > {
    const results = await this.db
      .prepare('SELECT * FROM models WHERE is_active = ? ORDER BY sort_order, name')
      .bind(true)
      .all<ModelRow>();

    const models = (results.results || []).map((row) => this.mapRowToModel(row));

    return models.map((model) => ({
      name: model.spec,
      label: model.label,
      preset: {
        endpoint: model.endpointType,
        modelLabel: model.modelLabel || model.label,
        model: model.modelId,
        temperature: model.temperature,
        top_p: model.topP,
        topP: model.topP,
        topK: model.topK,
        frequency_penalty: model.frequencyPenalty,
        presence_penalty: model.presencePenalty,
        maxOutputTokens: model.maxOutput,
        max_tokens: model.maxTokens,
        stop: model.stopSequences,
        reasoning_effort: model.reasoningEffort,
        resendFiles: model.resendFiles,
        promptCache: model.promptCache,
        thinking: model.thinking,
        thinkingBudget: model.thinkingBudget,
        promptPrefix: model.promptPrefix,
        system: model.systemMessage,
      },
      default: model.isDefault,
      description: model.description,
      iconURL: model.iconUrl || model.endpointType,
    }));
  }

  /**
   * Gets all models (active and inactive)
   * @returns Promise<Model[]> Array of all models
   */
  async findAll(): Promise<Model[]> {
    const results = await this.db
      .prepare('SELECT * FROM models ORDER BY endpoint_type, sort_order, name')
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

    // Basic model fields
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

    if (data.vision !== undefined) {
      updateFields.push('vision = ?');
      bindings.push(data.vision);
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

    // ModelSpecs fields
    if (data.spec !== undefined) {
      updateFields.push('spec = ?');
      bindings.push(data.spec);
    }

    if (data.label !== undefined) {
      updateFields.push('label = ?');
      bindings.push(data.label);
    }

    if (data.description !== undefined) {
      updateFields.push('description = ?');
      bindings.push(data.description);
    }

    if (data.iconUrl !== undefined) {
      updateFields.push('icon_url = ?');
      bindings.push(data.iconUrl);
    }

    if (data.isDefault !== undefined) {
      updateFields.push('is_default = ?');
      bindings.push(data.isDefault);
    }

    if (data.sortOrder !== undefined) {
      updateFields.push('sort_order = ?');
      bindings.push(data.sortOrder);
    }

    if (data.systemMessage !== undefined) {
      updateFields.push('system_message = ?');
      bindings.push(data.systemMessage);
    }

    // Preset fields
    if (data.modelLabel !== undefined) {
      updateFields.push('model_label = ?');
      bindings.push(data.modelLabel);
    }

    if (data.promptPrefix !== undefined) {
      updateFields.push('prompt_prefix = ?');
      bindings.push(data.promptPrefix);
    }

    if (data.temperature !== undefined) {
      updateFields.push('temperature = ?');
      bindings.push(data.temperature);
    }

    if (data.topP !== undefined) {
      updateFields.push('top_p = ?');
      bindings.push(data.topP);
    }

    if (data.topK !== undefined) {
      updateFields.push('top_k = ?');
      bindings.push(data.topK);
    }

    if (data.frequencyPenalty !== undefined) {
      updateFields.push('frequency_penalty = ?');
      bindings.push(data.frequencyPenalty);
    }

    if (data.presencePenalty !== undefined) {
      updateFields.push('presence_penalty = ?');
      bindings.push(data.presencePenalty);
    }

    if (data.maxTokens !== undefined) {
      updateFields.push('max_tokens = ?');
      bindings.push(data.maxTokens);
    }

    if (data.stopSequences !== undefined) {
      updateFields.push('stop_sequences = ?');
      bindings.push(data.stopSequences ? JSON.stringify(data.stopSequences) : null);
    }

    if (data.reasoningEffort !== undefined) {
      updateFields.push('reasoning_effort = ?');
      bindings.push(data.reasoningEffort);
    }

    if (data.resendFiles !== undefined) {
      updateFields.push('resend_files = ?');
      bindings.push(data.resendFiles);
    }

    if (data.promptCache !== undefined) {
      updateFields.push('prompt_cache = ?');
      bindings.push(data.promptCache);
    }

    if (data.thinkingBudget !== undefined) {
      updateFields.push('thinking_budget = ?');
      bindings.push(data.thinkingBudget);
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
      vision: Boolean(row.vision),
      contextWindow: row.context_window,
      maxOutput: row.max_output,
      knowledgeCutoff: row.knowledge_cutoff,
      inputPricePerMtok: row.input_price_per_mtok,
      outputPricePerMtok: row.output_price_per_mtok,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,

      // ModelSpecs fields
      spec: row.spec,
      label: row.label,
      description: row.description || undefined,
      iconUrl: row.icon_url || undefined,
      isDefault: Boolean(row.is_default),
      sortOrder: row.sort_order,
      systemMessage: row.system_message || undefined,

      // Preset fields
      modelLabel: row.model_label || undefined,
      promptPrefix: row.prompt_prefix || undefined,
      temperature: row.temperature || undefined,
      topP: row.top_p || undefined,
      topK: row.top_k || undefined,
      frequencyPenalty: row.frequency_penalty || undefined,
      presencePenalty: row.presence_penalty || undefined,
      maxTokens: row.max_tokens || undefined,
      stopSequences: row.stop_sequences ? JSON.parse(row.stop_sequences) : undefined,
      reasoningEffort: row.reasoning_effort || undefined,
      resendFiles: Boolean(row.resend_files),
      promptCache: Boolean(row.prompt_cache),
      thinkingBudget: row.thinking_budget || undefined,
    };
  }
}
