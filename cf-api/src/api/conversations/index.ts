import { Hono } from 'hono';
import {
  listConversations,
  getConversation,
  generateTitle,
  updateConversation,
  clearConversation,
  deleteConversations,
  deleteAllConversations,
} from './handlers';

/**
 * Conversation routes for /api/convos
 * Handles conversation CRUD operations
 */
const conversations = new Hono<{ Bindings: CloudflareBindings }>();

// GET /api/convos - List conversations with pagination and filtering
conversations.get('/', listConversations);

// GET /api/convos/:id - Get specific conversation
conversations.get('/:id', getConversation);

// POST /api/convos/gen_title - Generate conversation title
conversations.post('/gen_title', generateTitle);

// POST /api/convos/update - Update conversation
conversations.post('/update', updateConversation);

// POST /api/convos/clear - Clear/delete conversation(s) via POST (LibreChat compatibility)
conversations.post('/clear', clearConversation);

// DELETE /api/convos - Delete conversation(s)
conversations.delete('/', deleteConversations);

// DELETE /api/convos/all - Delete all conversations for user
conversations.delete('/all', deleteAllConversations);

export default conversations;
