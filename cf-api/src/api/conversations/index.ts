import { Hono } from 'hono';
import {
  listConversations,
  getConversation,
  updateConversation,
  deleteConversations,
  deleteAllConversations,
} from './handlers';

/**
 * Conversation routes for /api/convos
 * Handles CRUD operations for conversations
 */
const conversations = new Hono<{ Bindings: CloudflareBindings }>();

// GET /api/convos - List conversations with pagination and filtering
conversations.get('/', listConversations);

// GET /api/convos/:conversationId - Get a specific conversation
conversations.get('/:conversationId', getConversation);

// POST /api/convos/update - Update a conversation
conversations.post('/update', updateConversation);

// DELETE /api/convos - Delete specific conversation(s)
conversations.delete('/', deleteConversations);

// DELETE /api/convos/all - Delete all conversations for user
conversations.delete('/all', deleteAllConversations);

export default conversations;
