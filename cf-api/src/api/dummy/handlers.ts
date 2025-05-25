import { Context } from 'hono';
import { getAuth } from '@hono/oidc-auth';

/**
 * Handler for GET /api/balance
 * Returns user's token/credit balance
 * For MVP: Returns dummy balance string
 */
export async function getBalance(c: Context) {
  try {
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // MVP: Return dummy balance
    return c.text('unlimited');
  } catch (error) {
    console.error('[getBalance] Error:', error);
    return c.json({ error: 'Error fetching balance' }, 500);
  }
}

/**
 * Handler for GET /api/files
 * Returns user's uploaded files
 * For MVP: Returns empty array (no file support)
 */
export async function getFiles(c: Context) {
  try {
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // MVP: Return empty files array
    return c.json([]);
  } catch (error) {
    console.error('[getFiles] Error:', error);
    return c.json({ error: 'Error fetching files' }, 500);
  }
}

/**
 * Handler for GET /api/search/enable
 * Returns whether search functionality is enabled
 * For MVP: Returns false (search disabled)
 */
export async function getSearchEnabled(c: Context) {
  try {
    // MVP: Search is disabled
    return c.json(false);
  } catch (error) {
    console.error('[getSearchEnabled] Error:', error);
    return c.json({ error: 'Error checking search status' }, 500);
  }
}

/**
 * Handler for GET /api/files/config
 * Returns file upload configuration
 * For MVP: Returns minimal config with files disabled
 */
export async function getFileConfig(c: Context) {
  try {
    // MVP: Basic file config with everything disabled
    const fileConfig = {
      endpoints: {
        default: {
          disabled: true,
          fileLimit: 0,
          fileSizeLimit: 0,
          totalSizeLimit: 0,
          supportedMimeTypes: [],
        },
        anthropic: {
          disabled: true,
          fileLimit: 0,
          fileSizeLimit: 0,
          totalSizeLimit: 0,
          supportedMimeTypes: [],
        },
      },
      serverFileSizeLimit: 0,
      avatarSizeLimit: 0,
    };

    return c.json(fileConfig);
  } catch (error) {
    console.error('[getFileConfig] Error:', error);
    return c.json({ error: 'Error fetching file config' }, 500);
  }
}

/**
 * Handler for GET /api/agents/tools/web_search/auth
 * Returns web search tool authentication status
 * For MVP: Returns not authenticated (web search disabled)
 */
export async function getWebSearchAuth(c: Context) {
  try {
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // MVP: Web search not available
    return c.json({
      authenticated: false,
      message: 'user_provided',
    });
  } catch (error) {
    console.error('[getWebSearchAuth] Error:', error);
    return c.json({ error: 'Error checking web search auth' }, 500);
  }
}

/**
 * Handler for GET /api/agents/tools/execute_code/auth
 * Returns code execution tool authentication status
 * For MVP: Returns not authenticated (code execution disabled)
 */
export async function getCodeExecuteAuth(c: Context) {
  try {
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // MVP: Code execution not available
    return c.json({
      authenticated: false,
      message: 'user_provided',
    });
  } catch (error) {
    console.error('[getCodeExecuteAuth] Error:', error);
    return c.json({ error: 'Error checking code execution auth' }, 500);
  }
}

/**
 * Handler for GET /api/presets
 * Returns user's conversation presets
 * For MVP: Returns empty array (no presets)
 */
export async function getPresets(c: Context) {
  try {
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // MVP: Return empty presets array
    return c.json([]);
  } catch (error) {
    console.error('[getPresets] Error:', error);
    return c.json({ error: 'Error fetching presets' }, 500);
  }
}
