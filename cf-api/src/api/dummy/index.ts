import { Hono } from 'hono';
import {
  getBalance,
  getFiles,
  getSearchEnabled,
  getFileConfig,
  getWebSearchAuth,
  getCodeExecuteAuth,
  getPresets,
} from './handlers';

/**
 * Non-MVP API routes that return null or dummy data
 * These endpoints are required for the frontend but not part of the MVP functionality
 */
const dummy = new Hono();

// GET /api/balance - User balance (dummy)
dummy.get('/balance', getBalance);

// GET /api/search/enable - Search status (disabled)
dummy.get('/search/enable', getSearchEnabled);

// GET /api/agents/tools/web_search/auth - Web search auth (disabled)
dummy.get('/agents/tools/web_search/auth', getWebSearchAuth);

// GET /api/agents/tools/execute_code/auth - Code execution auth (disabled)
dummy.get('/agents/tools/execute_code/auth', getCodeExecuteAuth);

// GET /api/presets - User presets (empty)
dummy.get('/presets', getPresets);

export default dummy;
