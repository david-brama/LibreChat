/**
 * Files API Routes
 * Handles file upload, download, listing, and deletion
 * Compatible with LibreChat client expectations
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getFileConfig } from './config';
import { FileRepository } from '../../db/repositories/fileRepository';
import { FileProcessor } from '../../services/files/fileProcessor';
import { ModelRepository } from '../../db/repositories/model';
import type { TFileUpload } from '../../types';
import { getAuth } from '@hono/oidc-auth';

const files = new Hono<{ Bindings: CloudflareBindings }>();

/**
 * Get file configuration
 * GET /api/files/config
 */
files.get('/config', getFileConfig);

/**
 * Upload image file
 * POST /api/files/images
 */
files.post('/images', async (c) => {
  // Use OIDC authentication to get user context (same as messages endpoint)
  const oidcUser = await getAuth(c);
  if (!oidcUser) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const userId = oidcUser.sub;
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const fileId = formData.get('file_id') as string;
    const tempFileId = formData.get('temp_file_id') as string;
    const endpoint = formData.get('endpoint') as string;
    const width = parseInt((formData.get('width') as string) || '0');
    const height = parseInt((formData.get('height') as string) || '0');

    // Validate required fields
    if (!file || !fileId) {
      return c.json({ error: 'Missing required fields: file and file_id' }, 400);
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return c.json({ error: 'Only image files are allowed for this endpoint' }, 400);
    }

    // Check if endpoint has vision-capable models
    if (endpoint) {
      const modelRepository = new ModelRepository(c.env.DB);
      const models = await modelRepository.findByEndpoint(endpoint);
      const hasVisionModel = models.some((m) => m.vision && m.isActive);

      if (!hasVisionModel) {
        return c.json(
          {
            error: 'No vision-capable models available for this endpoint',
            suggestedAction: 'Please select an endpoint that supports image processing',
          },
          400,
        );
      }
    }

    // Process and upload file
    const fileRepository = new FileRepository(c.env.DB);
    const fileProcessor = new FileProcessor(c.env.R2_BUCKET, fileRepository);

    const result = await fileProcessor.processFile({
      file,
      fileId,
      tempFileId,
      userId,
      endpoint,
      width: width || undefined,
      height: height || undefined,
    });

    // Return LibreChat-compatible response
    const response: TFileUpload = {
      ...result,
      filepath: `/api/files/download/${userId}/${result.file_id}`,
    };

    return c.json(response);
  } catch (error) {
    console.error('Error uploading image:', error);
    return c.json(
      {
        error: 'Failed to upload image',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

/**
 * Download file
 * GET /api/files/download/:userId/:fileId
 */
files.get('/download/:userId/:fileId', async (c) => {
  // Use OIDC authentication to get user context
  const oidcUser = await getAuth(c);
  if (!oidcUser) {
    return c.text('Unauthorized', 401);
  }
  const userId = oidcUser.sub;
  try {
    const { userId: paramUserId, fileId } = c.req.param();

    // Verify user access
    if (paramUserId !== userId) {
      return c.text('Forbidden: You can only access your own files', 403);
    }

    // Get file metadata
    const fileRepository = new FileRepository(c.env.DB);
    const file = await fileRepository.findByIdAndUser(fileId, userId);

    if (!file) {
      return c.text('File not found', 404);
    }

    // Get file from R2
    const object = await c.env.R2_BUCKET.get(file.filepath);

    if (!object) {
      return c.text('File not found in storage', 404);
    }

    // Set appropriate headers
    const headers = new Headers();
    headers.set('Content-Type', file.type);
    headers.set('Content-Disposition', `inline; filename="${file.filename}"`);
    headers.set('Content-Length', file.bytes.toString());
    headers.set('Cache-Control', 'public, max-age=31536000'); // 1 year
    headers.set('ETag', `"${file.file_id}"`);

    // Increment usage count
    await fileRepository.incrementUsage(file.file_id);

    // Return file stream
    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Error downloading file:', error);
    return c.text('Internal server error', 500);
  }
});

/**
 * List user files
 * GET /api/files
 */
files.get('/', async (c) => {
  // Use OIDC authentication to get user context
  const oidcUser = await getAuth(c);
  if (!oidcUser) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const userId = oidcUser.sub;
  try {
    const fileRepository = new FileRepository(c.env.DB);
    const files = await fileRepository.findByUser(userId, {
      limit: 100,
      sortBy: 'created_at',
      sortOrder: 'desc',
    });

    // Transform to LibreChat format with download URLs
    const transformedFiles = files.map((file) => ({
      ...file,
      filepath: `/api/files/download/${userId}/${file.file_id}`,
    }));

    return c.json(transformedFiles);
  } catch (error) {
    console.error('Error listing files:', error);
    return c.json(
      {
        error: 'Failed to list files',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

/**
 * Upload general file
 * POST /api/files
 */
files.post('/', async (c) => {
  // Use OIDC authentication to get user context
  const oidcUser = await getAuth(c);
  if (!oidcUser) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const userId = oidcUser.sub;
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const fileId = formData.get('file_id') as string;
    const tempFileId = formData.get('temp_file_id') as string;
    const endpoint = formData.get('endpoint') as string;
    const width = parseInt((formData.get('width') as string) || '0');
    const height = parseInt((formData.get('height') as string) || '0');

    // Validate required fields
    if (!file || !fileId) {
      return c.json({ error: 'Missing required fields: file and file_id' }, 400);
    }

    // For now, only support images
    if (!file.type.startsWith('image/')) {
      return c.json(
        {
          error: 'Only image files are currently supported',
          suggestedAction: 'Please upload an image file (JPEG, PNG, GIF, or WebP)',
        },
        400,
      );
    }

    // Process and upload file
    const fileRepository = new FileRepository(c.env.DB);
    const fileProcessor = new FileProcessor(c.env.R2_BUCKET, fileRepository);

    const result = await fileProcessor.processFile({
      file,
      fileId,
      tempFileId,
      userId,
      endpoint,
      width: width || undefined,
      height: height || undefined,
    });

    // Return LibreChat-compatible response
    const response: TFileUpload = {
      ...result,
      filepath: `/api/files/download/${userId}/${result.file_id}`,
    };

    return c.json(response);
  } catch (error) {
    console.error('Error uploading file:', error);
    return c.json(
      {
        error: 'Failed to upload file',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

/**
 * Delete files
 * DELETE /api/files
 */
files.delete('/', async (c) => {
  // Use OIDC authentication to get user context
  const oidcUser = await getAuth(c);
  if (!oidcUser) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const userId = oidcUser.sub;
  try {
    const { files: filesToDelete } = await c.req.json();

    if (!Array.isArray(filesToDelete) || filesToDelete.length === 0) {
      return c.json({ error: 'No files provided for deletion' }, 400);
    }

    const fileRepository = new FileRepository(c.env.DB);
    const fileProcessor = new FileProcessor(c.env.R2_BUCKET, fileRepository);

    const fileIds = filesToDelete.map((f) => f.file_id).filter(Boolean);

    if (fileIds.length === 0) {
      return c.json({ error: 'No valid file IDs provided' }, 400);
    }

    // Verify ownership and get file metadata
    const dbFiles = await fileRepository.findByIds(fileIds);
    const userFiles = dbFiles.filter((f) => f.user === userId);
    const unauthorizedFiles = fileIds.filter((id) => !userFiles.find((f) => f.file_id === id));

    if (unauthorizedFiles.length > 0) {
      return c.json(
        {
          error: 'You can only delete your own files',
          unauthorizedFiles,
        },
        403,
      );
    }

    // Delete from R2 and database
    const deletePromises = userFiles.map(async (file) => {
      try {
        await fileProcessor.deleteFromR2(file.filepath);
        await fileRepository.delete(file.file_id, userId);
      } catch (error) {
        console.error(`Error deleting file ${file.file_id}:`, error);
      }
    });

    await Promise.all(deletePromises);

    return c.json({
      message: 'Files deleted successfully',
      deletedCount: userFiles.length,
    });
  } catch (error) {
    console.error('Error deleting files:', error);
    return c.json(
      {
        error: 'Failed to delete files',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

export default files;
