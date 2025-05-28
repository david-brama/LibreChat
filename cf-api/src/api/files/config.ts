/**
 * File Configuration API
 * Returns file upload configuration for different endpoints
 * GET /api/files/config
 */

import { Context } from 'hono';
import type { FileConfig } from '../../types';

/**
 * Get file configuration for all endpoints
 * Returns upload limits and supported file types
 */
export async function getFileConfig(c: Context): Promise<Response> {
  try {
    const config: FileConfig = {
      endpoints: {
        anthropic: {
          fileLimit: 5,
          fileSizeLimit: 10 * 1024 * 1024, // 10MB per file
          totalSizeLimit: 50 * 1024 * 1024, // 50MB total
          supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        },
        openAI: {
          fileLimit: 5,
          fileSizeLimit: 10 * 1024 * 1024, // 10MB per file
          totalSizeLimit: 50 * 1024 * 1024, // 50MB total
          supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        },
      },
      serverFileSizeLimit: 10 * 1024 * 1024, // 10MB
      avatarSizeLimit: 2 * 1024 * 1024, // 2MB
    };

    return c.json(config);
  } catch (error) {
    console.error('Error getting file config:', error);
    return c.json(
      {
        error: 'Failed to get file configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
}
