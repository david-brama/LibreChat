/**
 * FileProcessor - Handles file upload processing and R2 storage
 * Validates files, processes images, and stores them in Cloudflare R2
 */

import type {
  CreateFileDTO,
  File as LibreChatFile,
  TFileUpload,
  EndpointFileConfig,
} from '../../types';
import { FileRepository } from '../../db/repositories/fileRepository';

export interface ProcessFileOptions {
  file: File; // Browser File API
  fileId: string;
  tempFileId?: string;
  userId: string;
  endpoint?: string;
  width?: number;
  height?: number;
  conversationId?: string;
}

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
  suggestedAction?: string;
}

export class FileProcessor {
  constructor(
    private bucket: R2Bucket,
    private fileRepository: FileRepository,
  ) {}

  /**
   * Process and upload a file to R2 storage
   * @param options File processing options
   * @returns Processed file metadata
   */
  async processFile(options: ProcessFileOptions): Promise<TFileUpload> {
    const { file, fileId, tempFileId, userId, endpoint, width, height, conversationId } = options;

    // Validate file
    const validation = await this.validateFile(file, endpoint);
    if (!validation.isValid) {
      throw new Error(validation.error || 'File validation failed');
    }

    // Generate R2 object key
    const sanitizedFilename = this.sanitizeFilename(file.name);
    const r2Key = this.generateR2Key(userId, fileId, sanitizedFilename, file.type);

    // Read file data
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Upload to R2
    await this.uploadToR2(r2Key, buffer, file.type, {
      userId,
      fileId,
      originalName: file.name,
    });

    // Create file record in database
    const fileData: CreateFileDTO = {
      file_id: fileId,
      temp_file_id: tempFileId,
      user_id: userId,
      conversation_id: conversationId,
      filename: file.name,
      filepath: r2Key,
      type: file.type,
      bytes: file.size,
      source: 'r2',
      context: 'message_attachment',
      width,
      height,
      metadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
      },
    };

    const savedFile = await this.fileRepository.create(fileData);

    // Return LibreChat-compatible response
    return {
      ...savedFile,
      temp_file_id: tempFileId || fileId,
    };
  }

  /**
   * Validate file against endpoint configuration
   * @param file File to validate
   * @param endpoint Target endpoint
   * @returns Validation result
   */
  async validateFile(file: File, endpoint?: string): Promise<FileValidationResult> {
    // Basic file validation
    if (!file || file.size === 0) {
      return {
        isValid: false,
        error: 'File is empty or invalid',
      };
    }

    // Get endpoint configuration
    const config = this.getEndpointFileConfig(endpoint);

    // Check file size
    if (file.size > config.fileSizeLimit) {
      return {
        isValid: false,
        error: `File size exceeds limit of ${this.formatBytes(config.fileSizeLimit)}`,
      };
    }

    // Check MIME type
    if (!config.supportedMimeTypes.includes(file.type)) {
      return {
        isValid: false,
        error: `File type ${file.type} is not supported. Supported types: ${config.supportedMimeTypes.join(', ')}`,
      };
    }

    // Additional validation for images
    if (file.type.startsWith('image/')) {
      const validation = await this.validateImage(file);
      if (!validation.isValid) {
        return validation;
      }
    }

    return { isValid: true };
  }

  /**
   * Validate image file
   * Note: In Cloudflare Workers, we can't use Image() constructor
   * So we'll do basic validation and rely on client-side dimension detection
   * @param file Image file to validate
   * @returns Validation result
   */
  private async validateImage(file: File): Promise<FileValidationResult> {
    try {
      // Basic image validation - check if we can read the file
      const arrayBuffer = await file.arrayBuffer();

      // Check if file has content
      if (arrayBuffer.byteLength === 0) {
        return {
          isValid: false,
          error: 'Image file is empty',
        };
      }

      // Check file size (additional check for images)
      const maxImageSize = 20 * 1024 * 1024; // 20MB for images
      if (file.size > maxImageSize) {
        return {
          isValid: false,
          error: `Image size exceeds maximum of ${this.formatBytes(maxImageSize)}`,
        };
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: 'Failed to process image file',
      };
    }
  }

  /**
   * Upload file to R2 storage
   * @param key R2 object key
   * @param buffer File buffer
   * @param contentType MIME type
   * @param metadata Custom metadata
   */
  private async uploadToR2(
    key: string,
    buffer: Uint8Array,
    contentType: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    try {
      await this.bucket.put(key, buffer, {
        httpMetadata: {
          contentType,
          cacheControl: 'public, max-age=31536000', // 1 year
        },
        customMetadata: metadata,
      });
    } catch (error) {
      throw new Error(`Failed to upload file to R2: ${error}`);
    }
  }

  /**
   * Generate R2 object key for file storage
   * @param userId User ID
   * @param fileId File ID
   * @param filename Sanitized filename
   * @param mimeType File MIME type
   * @returns R2 object key
   */
  private generateR2Key(
    userId: string,
    fileId: string,
    filename: string,
    mimeType: string,
  ): string {
    const environment = this.getEnvironment();
    const basePath = mimeType.startsWith('image/') ? 'images' : 'files';

    return `${environment}/${basePath}/${userId}/${fileId}_${filename}`;
  }

  /**
   * Sanitize filename for safe storage
   * @param filename Original filename
   * @returns Sanitized filename
   */
  private sanitizeFilename(filename: string): string {
    // Remove or replace unsafe characters
    return filename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .substring(0, 255); // Limit length
  }

  /**
   * Get environment prefix for R2 keys
   * @returns Environment string
   */
  private getEnvironment(): string {
    // In production, this could be determined by environment variables
    return 'production';
  }

  /**
   * Get file configuration for endpoint
   * @param endpoint Target endpoint
   * @returns File configuration
   */
  private getEndpointFileConfig(endpoint?: string): EndpointFileConfig {
    // Default configuration for image uploads
    const defaultConfig: EndpointFileConfig = {
      fileLimit: 5,
      fileSizeLimit: 10 * 1024 * 1024, // 10MB
      totalSizeLimit: 50 * 1024 * 1024, // 50MB
      supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    };

    // Endpoint-specific configurations
    const endpointConfigs: Record<string, EndpointFileConfig> = {
      anthropic: {
        ...defaultConfig,
        supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      },
      openAI: {
        ...defaultConfig,
        supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      },
    };

    return endpointConfigs[endpoint || 'anthropic'] || defaultConfig;
  }

  /**
   * Format bytes to human readable string
   * @param bytes Number of bytes
   * @returns Formatted string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Delete file from R2 storage
   * @param filepath R2 object key
   */
  async deleteFromR2(filepath: string): Promise<void> {
    try {
      await this.bucket.delete(filepath);
    } catch (error) {
      console.error(`Failed to delete file from R2: ${filepath}`, error);
      // Don't throw error for delete operations to avoid blocking other operations
    }
  }

  /**
   * Get file from R2 storage
   * @param filepath R2 object key
   * @returns R2 object or null if not found
   */
  async getFromR2(filepath: string): Promise<R2Object | null> {
    try {
      return await this.bucket.get(filepath);
    } catch (error) {
      console.error(`Failed to get file from R2: ${filepath}`, error);
      return null;
    }
  }
}
