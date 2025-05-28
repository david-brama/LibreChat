/**
 * FileRepository - Handles all file-related database operations
 * Provides CRUD operations for file metadata stored in D1 database
 */

import type { File, FileRow, CreateFileDTO, UpdateFileDTO } from '../../types';

export class FileRepository {
  constructor(private db: D1Database) {}

  /**
   * Create a new file record
   */
  async create(data: CreateFileDTO): Promise<File> {
    const now = new Date().toISOString();

    const result = await this.db
      .prepare(
        `
        INSERT INTO files (
          file_id, temp_file_id, user_id, conversation_id, filename, filepath,
          type, bytes, source, context, width, height, metadata, expires_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .bind(
        data.file_id,
        data.temp_file_id || null,
        data.user_id,
        data.conversation_id || null,
        data.filename,
        data.filepath,
        data.type,
        data.bytes,
        data.source || 'r2',
        data.context || 'message_attachment',
        data.width || null,
        data.height || null,
        JSON.stringify(data.metadata || {}),
        data.expires_at || null,
        now,
        now,
      )
      .run();

    if (!result.success) {
      throw new Error(`Failed to create file: ${result.error}`);
    }

    const createdFile = await this.findById(data.file_id);
    if (!createdFile) {
      throw new Error('Failed to retrieve created file');
    }

    return createdFile;
  }

  /**
   * Find a file by its file_id
   */
  async findById(fileId: string): Promise<File | null> {
    const result = await this.db
      .prepare('SELECT * FROM files WHERE file_id = ?')
      .bind(fileId)
      .first<FileRow>();

    return result ? this.mapRowToFile(result) : null;
  }

  /**
   * Find a file by file_id and user_id (for access control)
   */
  async findByIdAndUser(fileId: string, userId: string): Promise<File | null> {
    const result = await this.db
      .prepare('SELECT * FROM files WHERE file_id = ? AND user_id = ?')
      .bind(fileId, userId)
      .first<FileRow>();

    return result ? this.mapRowToFile(result) : null;
  }

  /**
   * Find multiple files by their file_ids
   */
  async findByIds(fileIds: string[]): Promise<File[]> {
    if (fileIds.length === 0) return [];

    const placeholders = fileIds.map(() => '?').join(', ');
    const result = await this.db
      .prepare(`SELECT * FROM files WHERE file_id IN (${placeholders})`)
      .bind(...fileIds)
      .all<FileRow>();

    return result.results.map(this.mapRowToFile);
  }

  /**
   * Find files by user with optional filtering and pagination
   */
  async findByUser(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      sortBy?: 'created_at' | 'updated_at' | 'filename';
      sortOrder?: 'asc' | 'desc';
      conversationId?: string;
      type?: string;
    } = {},
  ): Promise<File[]> {
    const {
      limit = 50,
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'desc',
      conversationId,
      type,
    } = options;

    let query = 'SELECT * FROM files WHERE user_id = ?';
    const params: any[] = [userId];

    if (conversationId) {
      query += ' AND conversation_id = ?';
      params.push(conversationId);
    }

    if (type) {
      query += ' AND type LIKE ?';
      params.push(`${type}%`);
    }

    query += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await this.db
      .prepare(query)
      .bind(...params)
      .all<FileRow>();

    return result.results.map(this.mapRowToFile);
  }

  /**
   * Update a file record
   */
  async update(fileId: string, userId: string, data: UpdateFileDTO): Promise<File | null> {
    const updates: string[] = [];
    const params: any[] = [];

    // Build dynamic update query
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        if (key === 'metadata') {
          updates.push(`${key} = ?`);
          params.push(JSON.stringify(value));
        } else {
          updates.push(`${key} = ?`);
          params.push(value);
        }
      }
    });

    if (updates.length === 0) {
      return this.findByIdAndUser(fileId, userId);
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());

    params.push(fileId, userId);

    const result = await this.db
      .prepare(
        `
        UPDATE files 
        SET ${updates.join(', ')} 
        WHERE file_id = ? AND user_id = ?
      `,
      )
      .bind(...params)
      .run();

    if (!result.success || result.meta.changes === 0) {
      return null;
    }

    return this.findByIdAndUser(fileId, userId);
  }

  /**
   * Delete a file record
   */
  async delete(fileId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM files WHERE file_id = ? AND user_id = ?')
      .bind(fileId, userId)
      .run();

    return result.success && result.meta.changes > 0;
  }

  /**
   * Delete multiple files by IDs (with user verification)
   */
  async deleteByIds(fileIds: string[], userId: string): Promise<number> {
    if (fileIds.length === 0) return 0;

    const placeholders = fileIds.map(() => '?').join(', ');
    const result = await this.db
      .prepare(`DELETE FROM files WHERE file_id IN (${placeholders}) AND user_id = ?`)
      .bind(...fileIds, userId)
      .run();

    return result.meta.changes || 0;
  }

  /**
   * Increment usage count for a file
   */
  async incrementUsage(fileId: string): Promise<void> {
    await this.db
      .prepare(
        `
        UPDATE files 
        SET usage_count = usage_count + 1, updated_at = ? 
        WHERE file_id = ?
      `,
      )
      .bind(new Date().toISOString(), fileId)
      .run();
  }

  /**
   * Clean up expired files
   */
  async cleanupExpired(): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM files WHERE expires_at IS NOT NULL AND expires_at < ?')
      .bind(new Date().toISOString())
      .run();

    return result.meta.changes || 0;
  }

  /**
   * Get file statistics for a user
   */
  async getUserStats(userId: string): Promise<{
    totalFiles: number;
    totalBytes: number;
    imageCount: number;
    documentCount: number;
  }> {
    const result = await this.db
      .prepare(
        `
        SELECT 
          COUNT(*) as total_files,
          SUM(bytes) as total_bytes,
          SUM(CASE WHEN type LIKE 'image/%' THEN 1 ELSE 0 END) as image_count,
          SUM(CASE WHEN type NOT LIKE 'image/%' THEN 1 ELSE 0 END) as document_count
        FROM files 
        WHERE user_id = ?
      `,
      )
      .bind(userId)
      .first<{
        total_files: number;
        total_bytes: number;
        image_count: number;
        document_count: number;
      }>();

    return {
      totalFiles: result?.total_files || 0,
      totalBytes: result?.total_bytes || 0,
      imageCount: result?.image_count || 0,
      documentCount: result?.document_count || 0,
    };
  }

  /**
   * Map database row to File type
   */
  private mapRowToFile(row: FileRow): File {
    return {
      _id: row.id.toString(),
      file_id: row.file_id,
      temp_file_id: row.temp_file_id || undefined,
      user: row.user_id,
      filename: row.filename,
      filepath: row.filepath,
      type: row.type,
      bytes: row.bytes,
      source: row.source,
      width: row.width || undefined,
      height: row.height || undefined,
      embedded: false, // Not implemented yet
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
