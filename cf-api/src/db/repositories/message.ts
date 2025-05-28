import { CreateMessageDTO, Message, UpdateMessageDTO } from '../../types';

// Constants for parent message ID handling (matching LibreChat)
const NO_PARENT = '00000000-0000-0000-0000-000000000000';

/**
 * Repository class for managing messages in the D1 database
 * Handles CRUD operations for individual messages within conversations
 *
 * This follows LibreChat's pattern of separating message persistence
 * from conversation management and model inference.
 */
export class MessageRepository {
  constructor(private db: D1Database) {}

  /**
   * Creates a new message in the database
   */
  async create(data: CreateMessageDTO): Promise<Message> {
    const now = new Date().toISOString();
    const metadata = JSON.stringify(data.metadata || {});

    await this.db
      .prepare(
        `
        INSERT INTO messages (
          id, conversation_id, parent_message_id, user_id, sender, text,
          is_created_by_user, model, error, finish_reason, token_count,
          created_at, updated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .bind(
        data.messageId,
        data.conversationId,
        data.parentMessageId || null,
        data.userId,
        data.sender,
        data.text,
        data.isCreatedByUser,
        data.model || null,
        data.error || false,
        data.finishReason || null,
        data.tokenCount || null,
        now,
        now,
        metadata,
      )
      .run();

    const message = await this.findById(data.messageId);
    if (!message) {
      throw new Error('Failed to create message');
    }
    return message;
  }

  /**
   * Finds a message by its ID
   */
  async findById(messageId: string): Promise<Message | null> {
    const result = await this.db
      .prepare('SELECT * FROM messages WHERE id = ?')
      .bind(messageId)
      .first();

    if (!result) {
      return null;
    }

    return this.mapRowToMessage(result);
  }

  /**
   * Finds a message by ID and user (for security)
   */
  async findByIdAndUser(messageId: string, userId: string): Promise<Message | null> {
    const result = await this.db
      .prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?')
      .bind(messageId, userId)
      .first();

    if (!result) {
      return null;
    }

    return this.mapRowToMessage(result);
  }

  /**
   * Gets all messages for a conversation
   */
  async findByConversationId(conversationId: string, userId: string): Promise<Message[]> {
    const results = await this.db
      .prepare(
        `
        SELECT * FROM messages 
        WHERE conversation_id = ? AND user_id = ? 
        ORDER BY created_at ASC
      `,
      )
      .bind(conversationId, userId)
      .all();

    return results.results.map((row) => this.mapRowToMessage(row));
  }

  /**
   * Updates a message
   */
  async update(messageId: string, userId: string, data: UpdateMessageDTO): Promise<Message | null> {
    const updateFields: string[] = [];
    const bindings: any[] = [];

    if (data.text !== undefined) {
      updateFields.push('text = ?');
      bindings.push(data.text);
    }

    if (data.error !== undefined) {
      updateFields.push('error = ?');
      bindings.push(data.error);
    }

    if (data.finishReason !== undefined) {
      updateFields.push('finish_reason = ?');
      bindings.push(data.finishReason);
    }

    if (data.tokenCount !== undefined) {
      updateFields.push('token_count = ?');
      bindings.push(data.tokenCount);
    }

    if (data.metadata !== undefined) {
      updateFields.push('metadata = ?');
      bindings.push(JSON.stringify(data.metadata));
    }

    if (updateFields.length === 0) {
      // No fields to update, just return the existing message
      return this.findByIdAndUser(messageId, userId);
    }

    // Always update the updated_at timestamp
    updateFields.push('updated_at = ?');
    bindings.push(new Date().toISOString());

    // Add WHERE clause bindings
    bindings.push(messageId, userId);

    const query = `
      UPDATE messages 
      SET ${updateFields.join(', ')} 
      WHERE id = ? AND user_id = ?
    `;

    await this.db
      .prepare(query)
      .bind(...bindings)
      .run();

    return this.findByIdAndUser(messageId, userId);
  }

  /**
   * Deletes a message
   */
  async delete(messageId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM messages WHERE id = ? AND user_id = ?')
      .bind(messageId, userId)
      .run();

    return result.meta.changes > 0;
  }

  /**
   * Deletes all messages for a conversation
   */
  async deleteByConversationId(conversationId: string, userId: string): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM messages WHERE conversation_id = ? AND user_id = ?')
      .bind(conversationId, userId)
      .run();

    return result.meta.changes;
  }

  /**
   * Gets conversation history by following the parentMessageId chain from a specific message
   * Returns messages in chronological order (oldest first) that form the conversation thread
   * This is used to build context for AI model requests
   *
   * @param conversationId The conversation ID
   * @param userId The user ID for security
   * @param parentMessageId The message ID to start from (usually the user's latest message)
   * @returns Array of messages in chronological order forming the conversation thread
   */
  async getConversationHistory(
    conversationId: string,
    userId: string,
    parentMessageId: string,
  ): Promise<Message[]> {
    // Get all messages for the conversation first
    const allMessages = await this.findByConversationId(conversationId, userId);

    if (allMessages.length === 0) {
      return [];
    }

    // Build a map for quick lookup
    const messageMap = new Map<string, Message>();
    for (const message of allMessages) {
      messageMap.set(message.messageId, message);
    }

    // Follow the parentMessageId chain backwards to build the thread
    const orderedMessages: Message[] = [];
    let currentMessageId: string | null = parentMessageId;
    const visitedMessageIds = new Set<string>();

    while (currentMessageId) {
      // Prevent infinite loops
      if (visitedMessageIds.has(currentMessageId)) {
        console.warn('[MessageRepository] Circular reference detected in message chain:', {
          conversationId,
          currentMessageId,
        });
        break;
      }

      const message = messageMap.get(currentMessageId);
      visitedMessageIds.add(currentMessageId);

      if (!message) {
        console.warn('[MessageRepository] Message not found in chain:', {
          conversationId,
          messageId: currentMessageId,
        });
        break;
      }

      orderedMessages.push(message);

      // Move to parent message (null or NO_PARENT constant means root)
      currentMessageId =
        message.parentMessageId === NO_PARENT || message.parentMessageId === null
          ? null
          : message.parentMessageId;
    }

    // Reverse to get chronological order (oldest first)
    orderedMessages.reverse();

    console.log('[MessageRepository] Built conversation history:', {
      conversationId,
      startingFromMessageId: parentMessageId,
      historyLength: orderedMessages.length,
      messageIds: orderedMessages.map((m) => m.messageId),
    });

    return orderedMessages;
  }

  /**
   * Maps a database row to a Message object
   * Ensures proper type conversion from SQLite storage to expected types
   */
  private mapRowToMessage(row: any): Message {
    return {
      messageId: row.id,
      conversationId: row.conversation_id,
      parentMessageId: row.parent_message_id,
      user: row.user_id,
      sender: row.sender,
      text: row.text,
      isCreatedByUser: Boolean(row.is_created_by_user),
      model: row.model,
      error: Boolean(row.error),
      finish_reason: row.finish_reason,
      tokenCount: row.token_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };
  }
}
