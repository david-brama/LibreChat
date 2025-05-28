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

    // Associate files if provided
    if (data.fileIds && data.fileIds.length > 0) {
      await this.associateFiles(data.messageId, data.fileIds);
    }

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

    return this.mapRowToMessage(result, messageId);
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

    return this.mapRowToMessage(result, messageId);
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

    // Get files for all messages in batch for efficiency
    const messages = await Promise.all(
      results.results.map((row: any) => this.mapRowToMessage(row, row.id)),
    );

    return messages;
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
   * Associates files with a message
   * Creates records in the message_files junction table
   *
   * @param messageId The message ID to associate files with
   * @param fileIds Array of file IDs to associate
   * @returns Promise that resolves when all associations are created
   */
  async associateFiles(messageId: string, fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) {
      return;
    }

    const now = new Date().toISOString();

    // Use a transaction to ensure atomicity
    await this.db.batch(
      fileIds.map((fileId) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO message_files (message_id, file_id, created_at) 
             VALUES (?, ?, ?)`,
          )
          .bind(messageId, fileId, now),
      ),
    );

    console.log('[MessageRepository] Associated files with message:', {
      messageId,
      fileIds,
      count: fileIds.length,
    });
  }

  /**
   * Gets all file IDs associated with a message
   *
   * @param messageId The message ID to get files for
   * @returns Array of file IDs associated with the message
   */
  async getAssociatedFileIds(messageId: string): Promise<string[]> {
    const results = await this.db
      .prepare(
        `SELECT file_id FROM message_files 
         WHERE message_id = ? 
         ORDER BY created_at ASC`,
      )
      .bind(messageId)
      .all();

    return results.results.map((row: any) => row.file_id);
  }

  /**
   * Gets all files associated with a message with full file details
   * This joins with the files table to get complete file information
   *
   * @param messageId The message ID to get files for
   * @returns Array of file objects with complete information
   */
  async getAssociatedFiles(messageId: string): Promise<any[]> {
    const results = await this.db
      .prepare(
        `SELECT f.file_id, f.filename, f.filepath, f.type, f.bytes, 
                f.width, f.height, f.metadata, mf.created_at as associated_at
         FROM message_files mf
         JOIN files f ON mf.file_id = f.file_id
         WHERE mf.message_id = ?
         ORDER BY mf.created_at ASC`,
      )
      .bind(messageId)
      .all();

    return results.results.map((row: any) => ({
      type: row.type,
      file_id: row.file_id,
      filepath: row.filepath,
      filename: row.filename,
      embedded: false, // Default value as per LibreChat format
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      width: row.width,
      height: row.height,
    }));
  }

  /**
   * Removes file associations from a message
   *
   * @param messageId The message ID to remove file associations from
   * @param fileIds Optional array of specific file IDs to remove. If not provided, removes all associations
   * @returns Number of associations removed
   */
  async removeFileAssociations(messageId: string, fileIds?: string[]): Promise<number> {
    let query: string;
    let bindings: any[];

    if (fileIds && fileIds.length > 0) {
      const placeholders = fileIds.map(() => '?').join(', ');
      query = `DELETE FROM message_files WHERE message_id = ? AND file_id IN (${placeholders})`;
      bindings = [messageId, ...fileIds];
    } else {
      query = `DELETE FROM message_files WHERE message_id = ?`;
      bindings = [messageId];
    }

    const result = await this.db
      .prepare(query)
      .bind(...bindings)
      .run();

    const removedCount = result.meta.changes;

    console.log('[MessageRepository] Removed file associations:', {
      messageId,
      fileIds: fileIds || 'all',
      removedCount,
    });

    return removedCount;
  }

  /**
   * Gets all messages that reference a specific file
   * Useful for file management and cleanup operations
   *
   * @param fileId The file ID to find messages for
   * @param userId Optional user ID for filtering (security)
   * @returns Array of message IDs that reference the file
   */
  async getMessagesWithFile(fileId: string, userId?: string): Promise<string[]> {
    let query: string;
    let bindings: any[];

    if (userId) {
      query = `SELECT DISTINCT mf.message_id 
               FROM message_files mf
               JOIN messages m ON mf.message_id = m.id
               WHERE mf.file_id = ? AND m.user_id = ?`;
      bindings = [fileId, userId];
    } else {
      query = `SELECT message_id FROM message_files WHERE file_id = ?`;
      bindings = [fileId];
    }

    const results = await this.db
      .prepare(query)
      .bind(...bindings)
      .all();

    return results.results.map((row: any) => row.message_id);
  }

  /**
   * Maps a database row to a Message object
   * Ensures proper type conversion from SQLite storage to expected types
   * Includes associated files in the message object
   */
  private async mapRowToMessage(row: any, messageId: string): Promise<Message> {
    // Get associated files for this message
    const files = await this.getAssociatedFiles(messageId);

    return {
      messageId,
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
      files: files, // Include files in the message response
    };
  }
}
