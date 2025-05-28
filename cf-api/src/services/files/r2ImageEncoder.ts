/**
 * R2ImageEncoder - Processes images from R2 storage for AI providers
 * Handles encoding and formatting images for different AI providers (Anthropic, OpenAI)
 * Similar to LibreChat's encodeAndFormat function but adapted for Cloudflare R2
 */

import type {
  File,
  FileProcessingResult,
  ImageContent,
  ImageContentAnthropic,
  ImageContentOpenAI,
} from '../../types';
import { FileRepository } from '../../db/repositories/fileRepository';

export class R2ImageEncoder {
  constructor(
    private bucket: R2Bucket,
    private fileRepository: FileRepository,
  ) {}

  /**
   * Encodes and formats images for AI providers
   * @param fileIds Array of file IDs to process
   * @param userId User ID for access control
   * @param endpoint AI provider endpoint ('anthropic' or 'openAI')
   * @param mode Optional mode for specific formatting
   * @returns Processed files with image URLs and text content
   */
  async encodeAndFormat(
    fileIds: string[],
    userId: string,
    endpoint: string,
    mode?: string,
  ): Promise<FileProcessingResult> {
    console.log('[R2ImageEncoder] Starting encodeAndFormat:', {
      fileIds,
      userId,
      endpoint,
      mode,
      fileCount: fileIds?.length || 0,
    });

    const result: FileProcessingResult = {
      text: '',
      files: [],
      image_urls: [],
    };

    if (!fileIds?.length) {
      console.log('[R2ImageEncoder] No file IDs provided, returning empty result');
      return result;
    }

    console.log('[R2ImageEncoder] Getting file metadata from database...');

    // Get file metadata from database
    const files = await this.fileRepository.findByIds(fileIds);
    console.log('[R2ImageEncoder] Retrieved files from database:', {
      requestedCount: fileIds.length,
      foundCount: files.length,
      files: files.map((f) => ({
        file_id: f.file_id,
        user: f.user,
        type: f.type,
        width: f.width,
        height: f.height,
        filepath: f.filepath,
      })),
    });

    const userFiles = files.filter((f) => f.user === userId);
    console.log('[R2ImageEncoder] Filtered to user files:', {
      totalFiles: files.length,
      userFiles: userFiles.length,
      filteredOut: files.length - userFiles.length,
    });

    if (userFiles.length === 0) {
      console.log('[R2ImageEncoder] No files belong to user, returning empty result');
      return result;
    }

    // Process each file
    const imagePromises = userFiles.map(async (file) => {
      console.log(`[R2ImageEncoder] Processing file ${file.file_id}:`, {
        type: file.type,
        source: file.source,
        width: file.width,
        height: file.height,
        filepath: file.filepath,
      });

      // Handle text files (for future implementation)
      if (file.source === 'text' && file.metadata?.text) {
        console.log(`[R2ImageEncoder] Processing text file ${file.file_id}`);
        const textContent = file.metadata.text as string;
        result.text += `${!result.text ? 'Attached document(s):\n```md' : '\n\n---\n\n'}# "${file.filename}"\n${textContent}\n`;
        return [file, null] as [File, string | null];
      }

      // Only process images with dimensions
      if (!file.type.startsWith('image/') || !file.width || !file.height) {
        console.log(
          `[R2ImageEncoder] Skipping file ${file.file_id}: not an image or missing dimensions`,
          {
            isImage: file.type.startsWith('image/'),
            hasWidth: !!file.width,
            hasHeight: !!file.height,
          },
        );
        return [file, null] as [File, string | null];
      }

      try {
        console.log(`[R2ImageEncoder] Getting image from R2: ${file.filepath}`);

        // Get image data from R2
        const object = await this.bucket.get(file.filepath);
        if (!object) {
          console.warn(`[R2ImageEncoder] Image not found in R2: ${file.filepath}`);
          return [file, null] as [File, string | null];
        }

        console.log(`[R2ImageEncoder] Retrieved image from R2, size: ${object.size} bytes`);

        // Convert ArrayBuffer to base64 using web platform APIs (Cloudflare Workers runtime)
        // Note: We use web platform APIs instead of Node.js Buffer since CF Workers
        // is based on Web Standards (similar to browsers) rather than Node.js
        const arrayBuffer = await object.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        console.log(
          `[R2ImageEncoder] Converting to base64, array buffer size: ${arrayBuffer.byteLength}`,
        );

        // Efficiently convert Uint8Array to base64 using btoa()
        // btoa() is a web standard API available in Cloudflare Workers
        const base64Data = btoa(String.fromCharCode(...uint8Array));

        console.log(`[R2ImageEncoder] Base64 conversion complete, length: ${base64Data.length}`);

        // Increment usage count
        await this.fileRepository.incrementUsage(file.file_id);

        console.log(`[R2ImageEncoder] Successfully processed image ${file.file_id}`);

        return [file, base64Data] as [File, string | null];
      } catch (error) {
        console.error(`[R2ImageEncoder] Error processing image ${file.file_id}:`, error);
        return [file, null] as [File, string | null];
      }
    });

    // Wait for all image processing to complete
    const processedResults = await Promise.all(imagePromises);

    console.log('[R2ImageEncoder] Image processing completed:', {
      totalProcessed: processedResults.length,
      successfulImages: processedResults.filter(([_, base64]) => base64 !== null).length,
      failedImages: processedResults.filter(([_, base64]) => base64 === null).length,
    });

    // Format images for the specific provider
    for (const [file, base64Data] of processedResults) {
      if (!base64Data) {
        console.log(`[R2ImageEncoder] Skipping file ${file.file_id} - no base64 data`);
        continue;
      }

      console.log(`[R2ImageEncoder] Formatting image ${file.file_id} for endpoint: ${endpoint}`);

      // Add to files array
      result.files.push(file);

      // Create provider-specific image URL format
      const dataUrl = `data:${file.type};base64,${base64Data}`;

      console.log(`[R2ImageEncoder] Created data URL for ${file.file_id}:`, {
        type: file.type,
        dataUrlLength: dataUrl.length,
        dataUrlPrefix: dataUrl.substring(0, 100) + '...',
      });

      if (endpoint === 'anthropic') {
        console.log(`[R2ImageEncoder] Formatting for Anthropic: ${file.file_id}`);
        const imageContent = {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: file.type,
            data: base64Data,
          },
        };
        console.log(`[R2ImageEncoder] Anthropic format created:`, {
          type: imageContent.type,
          sourceType: imageContent.source.type,
          mediaType: imageContent.source.media_type,
          dataLength: imageContent.source.data.length,
        });
        result.image_urls.push(imageContent);
      } else if (endpoint === 'openAI') {
        console.log(`[R2ImageEncoder] Formatting for OpenAI: ${file.file_id}`);
        const imageContent = {
          type: 'image_url' as const,
          image_url: {
            url: dataUrl,
            detail: 'auto' as const, // OpenAI detail level
          },
        };
        console.log(`[R2ImageEncoder] OpenAI format created:`, {
          type: imageContent.type,
          imageUrlKeys: Object.keys(imageContent.image_url),
          imageUrlDetail: imageContent.image_url.detail,
          urlLength: imageContent.image_url.url.length,
          urlPrefix: imageContent.image_url.url.substring(0, 100) + '...',
        });
        result.image_urls.push(imageContent);
      }

      console.log(
        `[R2ImageEncoder] Added image ${file.file_id} to result.image_urls, total count: ${result.image_urls.length}`,
      );
    }

    // Add text content closing if we had documents
    if (result.text && !result.text.endsWith('```')) {
      result.text += '\n```';
    }

    console.log('[R2ImageEncoder] Final result:', {
      hasText: !!result.text,
      textLength: result.text?.length || 0,
      filesCount: result.files.length,
      imageUrlsCount: result.image_urls.length,
      endpoint,
    });

    return result;
  }

  /**
   * Validate if files are images and user has access
   * @param fileIds Array of file IDs to validate
   * @param userId User ID for access control
   * @returns Validation result with accessible image files
   */
  async validateImageFiles(
    fileIds: string[],
    userId: string,
  ): Promise<{
    validFiles: File[];
    invalidFiles: string[];
    hasImages: boolean;
  }> {
    if (!fileIds?.length) {
      return { validFiles: [], invalidFiles: [], hasImages: false };
    }

    const files = await this.fileRepository.findByIds(fileIds);
    const validFiles: File[] = [];
    const invalidFiles: string[] = [];

    for (const fileId of fileIds) {
      const file = files.find((f) => f.file_id === fileId);

      if (!file) {
        invalidFiles.push(fileId);
        continue;
      }

      if (file.user !== userId) {
        invalidFiles.push(fileId);
        continue;
      }

      validFiles.push(file);
    }

    const hasImages = validFiles.some((f) => f.type.startsWith('image/') && f.width && f.height);

    return { validFiles, invalidFiles, hasImages };
  }

  /**
   * Get file download URL for client access
   * @param fileId File ID
   * @param userId User ID for access control
   * @returns Download URL or null if not accessible
   */
  async getDownloadUrl(fileId: string, userId: string): Promise<string | null> {
    const file = await this.fileRepository.findByIdAndUser(fileId, userId);
    if (!file) {
      return null;
    }

    return `/api/files/download/${userId}/${fileId}`;
  }

  /**
   * Check if a file exists in R2 storage
   * @param filepath R2 object key
   * @returns True if file exists in R2
   */
  async fileExistsInR2(filepath: string): Promise<boolean> {
    try {
      const object = await this.bucket.head(filepath);
      return object !== null;
    } catch {
      return false;
    }
  }
}
