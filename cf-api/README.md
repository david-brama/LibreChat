# LibreChat Cloudflare Backend

A serverless backend for LibreChat built with Cloudflare Workers, Hono, and D1.

## Features

- **Serverless Architecture**: Built on Cloudflare Workers for global edge deployment
- **D1 Database**: Uses Cloudflare's D1 SQLite database for data persistence
- **OIDC Authentication**: Integrated authentication with Microsoft/other OIDC providers
- **Compatible API**: Drop-in replacement for LibreChat's Node.js backend
- **Conversation Management**: Full CRUD operations for conversations and messages
- **Anthropic Claude Integration**: Streaming chat completions with Claude 4.0 Sonnet
- **Automatic Title Generation**: Uses Claude 3.5 Haiku for fast, cost-effective conversation titling

## Setup

### 1. Prerequisites

- Node.js 18+
- Cloudflare account with Workers and D1 enabled
- Wrangler CLI installed: `npm install -g wrangler`

### 2. Database Setup

Create a D1 database:

```bash
wrangler d1 create librechat
```

Update `wrangler.jsonc` with your database ID:

```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "librechat",
    "database_id": "your-database-id-here"
  }
]
```

Run the database migrations:

```bash
wrangler d1 execute librechat --file=./src/db/migrations/001_initial_schema.sql
```

### 3. KV Storage Setup (Optional - for Title Generation)

Create a KV namespace for caching conversation titles:

```bash
wrangler kv:namespace create "TITLE_CACHE"
```

Update `wrangler.jsonc` with your KV namespace ID:

```json
"kv_namespaces": [
  {
    "binding": "TITLE_CACHE",
    "id": "your-title-cache-namespace-id-here"
  }
]
```

### 4. Environment Configuration

Set up OIDC authentication secrets:

```bash
wrangler secret put OIDC_CLIENT_ID
wrangler secret put OIDC_CLIENT_SECRET
wrangler secret put OIDC_ISSUER
```

Set up Anthropic API key for AI chat completion:

```bash
wrangler secret put ANTHROPIC_API_KEY
```

### 5. Development

Start the development server:

```bash
npm run dev
```

The API will be available at `http://localhost:8787`

### 6. Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

## API Endpoints

### Conversations

- `GET /api/convos` - List conversations with pagination
  - Query params: `cursor`, `limit`, `isArchived`, `tags[]`, `search`, `order`
- `GET /api/convos/:id` - Get specific conversation
- `POST /api/convos/gen_title` - Generate conversation title (LibreChat compatibility)
- `POST /api/convos/update` - Update conversation
- `DELETE /api/convos` - Delete conversation(s)
- `DELETE /api/convos/all` - Delete all conversations

### Chat Completion

- `POST /api/ask/anthropic` - Send message to Anthropic Claude with SSE streaming

### Authentication

- `GET /api/user` - Get current user info
- `POST /api/auth/refresh` - Refresh authentication token
- `GET /logout` - Logout user
- `GET /callback` - OIDC callback handler

## Database Schema

### Conversations Table

```sql
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,           -- conversationId
    user_id TEXT NOT NULL,         -- User who owns conversation
    title TEXT DEFAULT 'New Chat', -- Conversation title
    endpoint TEXT,                 -- AI endpoint used
    model TEXT,                    -- AI model used
    created_at DATETIME,
    updated_at DATETIME,
    is_archived BOOLEAN DEFAULT FALSE,
    settings TEXT DEFAULT '{}',    -- JSON: model parameters
    tags TEXT DEFAULT '[]',        -- JSON: conversation tags
    metadata TEXT DEFAULT '{}'     -- JSON: additional metadata
);
```

### Messages Table

```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,              -- messageId
    conversation_id TEXT NOT NULL,    -- Foreign key to conversations
    parent_message_id TEXT,           -- Parent message for threading
    user_id TEXT NOT NULL,            -- Message owner
    sender TEXT NOT NULL,             -- 'user' or 'assistant'
    text TEXT NOT NULL,               -- Message content
    is_created_by_user BOOLEAN NOT NULL,
    model TEXT,                       -- AI model used
    error BOOLEAN DEFAULT FALSE,
    finish_reason TEXT,               -- Completion reason
    token_count INTEGER,              -- Token count
    created_at DATETIME,
    updated_at DATETIME,
    metadata TEXT DEFAULT '{}'        -- JSON: files, plugins, etc.
);
```

## Architecture

```
cf-api/
├── src/
│   ├── index.ts              # Main Hono app entry point
│   ├── types/                # TypeScript type definitions
│   ├── api/                  # API route handlers
│   │   ├── conversations/    # Conversation endpoints
│   │   └── index.ts          # API routes aggregator
│   ├── db/
│   │   ├── migrations/       # SQL database migrations
│   │   └── repositories/     # Data access layer
│   └── services/             # Business logic services
├── wrangler.jsonc            # Cloudflare Workers configuration
└── package.json
```

## Development Notes

- All timestamps are stored in ISO 8601 format
- JSON fields allow flexible storage of LibreChat's complex data structures
- Cursor-based pagination for efficient large dataset handling
- Comprehensive indexing strategy for query performance
- Compatible with LibreChat's existing frontend without modifications

## Contributing

1. Follow TypeScript best practices
2. Add comprehensive JSDoc documentation
3. Include error handling for all database operations
4. Test with LibreChat frontend for compatibility
5. Maintain backward compatibility with existing API contracts

```txt
npm install
npm run dev
```

```txt
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```
