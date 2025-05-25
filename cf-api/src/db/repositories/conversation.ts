import {
  Conversation,
  ConversationRow,
  ConversationListParams,
  ConversationListResponse,
  CreateConversationDTO,
  UpdateConversationDTO,
} from '../../types';

/**
 * Repository class for handling conversation data operations with D1 database
 */
export class ConversationRepository {
  constructor(private db: D1Database) {}

  /**
   * Creates a new conversation in the database
   */
  async create(data: CreateConversationDTO): Promise<Conversation> {
    const now = new Date().toISOString();
    const settings = JSON.stringify(data.settings || {});
    const metadata = JSON.stringify(data.metadata || {});
    const tags = JSON.stringify([]);

    await this.db
      .prepare(
        `
        INSERT INTO conversations (
          id, user_id, title, endpoint, model, created_at, updated_at, 
          is_archived, settings, tags, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .bind(
        data.conversationId,
        data.userId,
        data.title || 'New Chat',
        data.endpoint || null,
        data.model || null,
        now,
        now,
        false,
        settings,
        tags,
        metadata,
      )
      .run();

    const conversation = await this.findById(data.conversationId);
    if (!conversation) {
      throw new Error('Failed to create conversation');
    }
    return conversation;
  }

  /**
   * Finds a conversation by ID
   */
  async findById(conversationId: string): Promise<Conversation | null> {
    const result = await this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .bind(conversationId)
      .first<ConversationRow>();

    return result ? this.mapRowToConversation(result) : null;
  }

  /**
   * Finds a conversation by ID and user ID for security
   */
  async findByIdAndUser(conversationId: string, userId: string): Promise<Conversation | null> {
    const result = await this.db
      .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
      .bind(conversationId, userId)
      .first<ConversationRow>();

    return result ? this.mapRowToConversation(result) : null;
  }

  /**
   * Lists conversations for a user with pagination and filtering
   */
  async findByUser(
    userId: string,
    params: ConversationListParams = {},
  ): Promise<ConversationListResponse> {
    const { cursor, limit = 25, isArchived = false, tags = [], search, order = 'desc' } = params;

    let query = `
      SELECT * FROM conversations 
      WHERE user_id = ? AND is_archived = ?
    `;
    const bindings: any[] = [userId, isArchived];

    // Add tag filtering
    if (tags.length > 0) {
      const tagConditions = tags.map(() => 'json_extract(tags, "$") LIKE ?').join(' OR ');
      query += ` AND (${tagConditions})`;
      tags.forEach((tag) => bindings.push(`%"${tag}"%`));
    }

    // Add search functionality
    if (search) {
      query += ` AND title LIKE ?`;
      bindings.push(`%${search}%`);
    }

    // Add cursor-based pagination
    if (cursor) {
      const operator = order === 'desc' ? '<' : '>';
      query += ` AND updated_at ${operator} ?`;
      bindings.push(cursor);
    }

    // Add ordering and limit
    query += ` ORDER BY updated_at ${order.toUpperCase()}`;
    query += ` LIMIT ?`;
    bindings.push(limit + 1); // Fetch one extra to determine if there's a next page

    const results = await this.db
      .prepare(query)
      .bind(...bindings)
      .all<ConversationRow>();

    const conversations = results.results || [];

    // Determine next cursor
    let nextCursor: string | null = null;
    if (conversations.length > limit) {
      const lastConvo = conversations.pop(); // Remove the extra item
      nextCursor = lastConvo?.updated_at || null;
    }

    return {
      conversations: conversations.map((row) => this.mapRowToConversation(row)),
      nextCursor,
    };
  }

  /**
   * Updates a conversation
   */
  async update(
    conversationId: string,
    userId: string,
    data: UpdateConversationDTO,
  ): Promise<Conversation | null> {
    const updateFields: string[] = [];
    const bindings: any[] = [];

    if (data.title !== undefined) {
      updateFields.push('title = ?');
      bindings.push(data.title);
    }

    if (data.endpoint !== undefined) {
      updateFields.push('endpoint = ?');
      bindings.push(data.endpoint);
    }

    if (data.model !== undefined) {
      updateFields.push('model = ?');
      bindings.push(data.model);
    }

    if (data.isArchived !== undefined) {
      updateFields.push('is_archived = ?');
      bindings.push(data.isArchived);
    }

    if (data.tags !== undefined) {
      updateFields.push('tags = ?');
      bindings.push(JSON.stringify(data.tags));
    }

    if (data.settings !== undefined) {
      updateFields.push('settings = ?');
      bindings.push(JSON.stringify(data.settings));
    }

    if (data.metadata !== undefined) {
      updateFields.push('metadata = ?');
      bindings.push(JSON.stringify(data.metadata));
    }

    if (updateFields.length === 0) {
      // No fields to update, just return the existing conversation
      return this.findByIdAndUser(conversationId, userId);
    }

    // Always update the updated_at timestamp
    updateFields.push('updated_at = ?');
    bindings.push(new Date().toISOString());

    // Add WHERE clause bindings
    bindings.push(conversationId, userId);

    const query = `
      UPDATE conversations 
      SET ${updateFields.join(', ')} 
      WHERE id = ? AND user_id = ?
    `;

    await this.db
      .prepare(query)
      .bind(...bindings)
      .run();

    return this.findByIdAndUser(conversationId, userId);
  }

  /**
   * Deletes a conversation
   */
  async delete(conversationId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?')
      .bind(conversationId, userId)
      .run();

    return (result.meta.changes || 0) > 0;
  }

  /**
   * Deletes all conversations for a user
   */
  async deleteAllByUser(userId: string): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM conversations WHERE user_id = ?')
      .bind(userId)
      .run();

    return result.meta.changes || 0;
  }

  /**
   * Maps a database row to a Conversation object
   * Ensures proper type conversion from SQLite storage to expected types
   */
  private mapRowToConversation(row: ConversationRow): Conversation {
    const settings = this.safeJsonParse(row.settings, {});
    const metadata = this.safeJsonParse(row.metadata, {});
    const tags = this.safeJsonParse(row.tags, []);

    return {
      conversationId: row.id,
      user: row.user_id,
      title: row.title,
      endpoint: row.endpoint,
      model: row.model || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Convert SQLite integer (0/1) to proper boolean
      isArchived: Boolean(row.is_archived),
      tags,
      ...settings,
      ...metadata,
    };
  }

  /**
   * Safely parses JSON with fallback
   */
  private safeJsonParse(jsonString: string | null, fallback: any): any {
    if (!jsonString) return fallback;
    try {
      return JSON.parse(jsonString);
    } catch {
      return fallback;
    }
  }
}
