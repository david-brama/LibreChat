# Message and Agent Retrieval Endpoints

## Overview

These endpoints complete our conversation persistence implementation by providing read access to stored conversations, messages, and agent data. They complement the write operations handled in the `/api/ask/anthropic` endpoint.

## Implemented Endpoints

### 1. Messages API (`/api/messages`)

#### GET `/api/messages/:conversationId`

**Purpose**: Retrieve all messages for a specific conversation
**Used by**: LibreChat frontend to load conversation history when opening a chat

**Request Example**:

```
GET /api/messages/6c1a8efa-5151-46f9-8e75-ebb6ec4191b2
Authorization: Bearer <token>
```

**Response Example**:

```json
[
  {
    "messageId": "msg-001",
    "conversationId": "6c1a8efa-5151-46f9-8e75-ebb6ec4191b2",
    "parentMessageId": null,
    "user": "user123",
    "sender": "User",
    "text": "Hello, how are you?",
    "isCreatedByUser": true,
    "model": "claude-sonnet-4-20250514",
    "error": false,
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z",
    "metadata": {}
  },
  {
    "messageId": "msg-002",
    "conversationId": "6c1a8efa-5151-46f9-8e75-ebb6ec4191b2",
    "parentMessageId": "msg-001",
    "user": "user123",
    "sender": "Claude",
    "text": "Hello! I'm doing well, thank you for asking.",
    "isCreatedByUser": false,
    "model": "claude-sonnet-4-20250514",
    "error": false,
    "tokenCount": 12,
    "createdAt": "2024-01-15T10:00:05Z",
    "updatedAt": "2024-01-15T10:00:05Z",
    "metadata": {}
  }
]
```

**Features**:

- ✅ User authentication and authorization
- ✅ Returns messages in chronological order
- ✅ Includes all message metadata (tokens, timestamps, etc.)
- ✅ Secure (only returns messages owned by authenticated user)

#### GET `/api/messages/:conversationId/:messageId`

**Purpose**: Retrieve a specific message by ID
**Used by**: Individual message operations, editing, or detailed views

**Features**:

- ✅ Validates message belongs to the conversation
- ✅ Secure user ownership verification
- ✅ Returns 404 if message not found

### 2. Agents API (`/api/agents`)

#### GET `/api/agents/tools/calls?conversationId=:id`

**Purpose**: Retrieve tool calls for a specific conversation
**Used by**: LibreChat frontend to display agent tool call history

**Request Example**:

```
GET /api/agents/tools/calls?conversationId=6c1a8efa-5151-46f9-8e75-ebb6ec4191b2
Authorization: Bearer <token>
```

**Response Example** (MVP):

```json
[]
```

**MVP Implementation**: Returns empty array since we don't have agent tools implemented yet.

**Future Implementation**: Will return tool calls with structure like:

```json
[
  {
    "id": "call-001",
    "conversationId": "6c1a8efa-5151-46f9-8e75-ebb6ec4191b2",
    "messageId": "msg-002",
    "toolName": "web_search",
    "input": { "query": "weather today" },
    "output": { "result": "sunny, 75°F" },
    "status": "completed",
    "createdAt": "2024-01-15T10:00:03Z"
  }
]
```

#### GET `/api/agents/tools/auth`

**Purpose**: Check authentication status for various agent tools
**Used by**: LibreChat frontend to show which tools are available

**Response Example** (MVP):

```json
{
  "web_search": false,
  "execute_code": false
}
```

#### GET `/api/agents`

**Purpose**: List available agents
**Used by**: LibreChat frontend for agent selection

**Response Example** (MVP):

```json
[]
```

## Architecture Integration

### Repository Usage

```typescript
// Messages endpoint uses MessageRepository
const messageRepository = new MessageRepository(c.env.DB);
const messages = await messageRepository.findByConversationId(conversationId, userId);
```

### Security Model

- **Authentication**: All endpoints require OIDC authentication
- **Authorization**: Users can only access their own data
- **Validation**: Conversation and message IDs are validated
- **Error Handling**: Graceful error responses with appropriate HTTP status codes

### Database Queries

```sql
-- Get messages for conversation
SELECT * FROM messages
WHERE conversation_id = ? AND user_id = ?
ORDER BY created_at ASC

-- Get specific message
SELECT * FROM messages
WHERE id = ? AND user_id = ?
```

## Performance Considerations

### Indexing

Our database schema includes proper indexes for efficient queries:

```sql
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_user_id ON messages(user_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
```

### Query Optimization

- **Conversation-based queries**: Use conversation_id + user_id composite filtering
- **Chronological ordering**: Messages returned in creation order for proper conversation flow
- **User isolation**: All queries include user_id filter for security and performance

### Potential Enhancements

1. **Pagination**: For conversations with many messages
2. **Caching**: Cache frequently accessed conversations
3. **Lazy Loading**: Load messages in chunks for better UX

## Error Handling

### Common Error Responses

**401 Unauthorized**:

```json
{
  "error": "Unauthorized"
}
```

**404 Not Found**:

```json
{
  "error": "Message not found"
}
```

**500 Internal Server Error**:

```json
{
  "error": "Internal server error"
}
```

### Error Scenarios Handled

- ✅ Unauthenticated requests
- ✅ Missing conversation/message IDs
- ✅ Messages not found
- ✅ Messages not belonging to user
- ✅ Database connection errors
- ✅ Invalid message-conversation relationships

## Testing

### Unit Tests

```typescript
describe('Messages API', () => {
  test('should return messages for conversation', async () => {
    // Test conversation message retrieval
  });

  test('should return 404 for non-existent message', async () => {
    // Test message not found scenario
  });

  test('should enforce user ownership', async () => {
    // Test security isolation
  });
});
```

### Integration Tests

```typescript
describe('Message Retrieval Flow', () => {
  test('should retrieve messages after conversation', async () => {
    // 1. Create conversation via /api/ask/anthropic
    // 2. Retrieve messages via /api/messages/:id
    // 3. Verify message order and content
  });
});
```

## Compatibility with LibreChat

These endpoints maintain full compatibility with LibreChat's frontend expectations:

### Message Format

- ✅ Compatible with LibreChat's Message type
- ✅ Includes all required fields (messageId, conversationId, sender, etc.)
- ✅ Proper timestamp formatting
- ✅ Metadata field for extensibility

### API Behavior

- ✅ Expected HTTP status codes
- ✅ JSON response format
- ✅ Error message structure
- ✅ Authentication flow

### Frontend Integration

- ✅ Works with existing LibreChat conversation loading
- ✅ Supports message threading via parentMessageId
- ✅ Compatible with agent/tool UI (returns empty arrays for MVP)

## Future Enhancements

### True Agent Support

When implementing full agent capabilities:

1. **Tool Calls Table**: Store tool invocations and results
2. **Agent Configurations**: Store agent settings and capabilities
3. **Tool Authentication**: Implement proper OAuth flows for external tools

### Advanced Message Features

1. **Message Editing**: Support for message modification history
2. **Message Reactions**: Store user reactions to messages
3. **Message Search**: Full-text search across conversation history

### Performance Optimizations

1. **Message Pagination**: Implement cursor-based pagination for large conversations
2. **Selective Loading**: Load only recent messages initially
3. **Background Sync**: Preload adjacent conversations for better UX
