# Cloudflare Workers Backend Example Structure

## Project Structure

```
librechat-cf-backend/
├── src/
│   ├── index.ts              # Main entry point
│   ├── routes/
│   │   ├── auth.ts          # Authentication routes
│   │   ├── config.ts        # Configuration routes
│   │   ├── conversations.ts # Conversation management
│   │   ├── messages.ts      # Message handling
│   │   ├── files.ts         # File management
│   │   └── models.ts        # Model configuration
│   ├── middleware/
│   │   ├── auth.ts          # JWT authentication
│   │   ├── cors.ts          # CORS handling
│   │   └── rateLimit.ts     # Rate limiting
│   ├── services/
│   │   ├── ai/
│   │   │   ├── openai.ts
│   │   │   ├── anthropic.ts
│   │   │   └── stream.ts    # SSE streaming
│   │   ├── database/
│   │   │   ├── schema.ts    # D1 schema
│   │   │   └── queries.ts   # Database queries
│   │   └── storage/
│   │       ├── r2.ts        # R2 file storage
│   │       └── kv.ts        # KV cache
│   ├── models/
│   │   ├── user.ts
│   │   ├── conversation.ts
│   │   ├── message.ts
│   │   └── preset.ts        # Model presets
│   └── utils/
│       ├── jwt.ts
│       └── validation.ts
├── wrangler.toml            # Cloudflare configuration
├── schema.sql               # D1 database schema
└── package.json
```

## Example Implementation

### 1. Main Entry Point (src/index.ts)

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import authRoutes from './routes/auth';
import configRoutes from './routes/config';
import conversationRoutes from './routes/conversations';
import messageRoutes from './routes/messages';

type Bindings = {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
  VECTORIZE: VectorizeIndex;
  JWT_SECRET: string;
  OPENAI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Middleware
app.use('*', cors());
app.use('/api/*', jwt({
  secret: (c) => c.env.JWT_SECRET,
  // Skip auth for certain routes
  skip: ['/api/auth/login', '/api/auth/register', '/api/config']
}));

// Health check
app.get('/health', (c) => c.text('OK'));

// Routes
app.route('/api/auth', authRoutes);
app.route('/api/config', configRoutes);
app.route('/api/convos', conversationRoutes);
app.route('/api/messages', messageRoutes);

export default app;
```

### 2. Model Presets Schema (schema.sql)

```sql
-- User groups for preset management
CREATE TABLE IF NOT EXISTS user_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Model presets configuration
CREATE TABLE IF NOT EXISTS model_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id TEXT,
  group_id TEXT,
  endpoint TEXT NOT NULL,
  model TEXT NOT NULL,
  system_message TEXT,
  parameters JSON,
  tools JSON,
  is_default BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES user_groups(id)
);

-- User preset assignments
CREATE TABLE IF NOT EXISTS user_preset_assignments (
  user_id TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  PRIMARY KEY (user_id, preset_id),
  FOREIGN KEY (preset_id) REFERENCES model_presets(id)
);
```

### 3. Configuration Route Example (src/routes/config.ts)

```typescript
import { Hono } from 'hono';

const config = new Hono<{ Bindings: Bindings }>();

config.get('/', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  
  // Get user's active presets
  const presets = await c.env.DB.prepare(`
    SELECT mp.* FROM model_presets mp
    JOIN user_preset_assignments upa ON mp.id = upa.preset_id
    WHERE upa.user_id = ? AND upa.is_active = true
    ORDER BY mp.priority DESC
  `).bind(userId).all();

  // Return LibreChat-compatible config
  return c.json({
    appTitle: 'LibreChat',
    endpoints: {
      custom: presets.results.map(preset => ({
        name: preset.name,
        endpoint: preset.endpoint,
        model: preset.model,
        systemMessage: preset.system_message,
        parameters: JSON.parse(preset.parameters || '{}'),
        tools: JSON.parse(preset.tools || '{}')
      }))
    },
    // ... other config options
  });
});

export default config;
```

### 4. Message Streaming Example (src/routes/messages.ts)

```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { generateAIResponse } from '../services/ai/openai';

const messages = new Hono<{ Bindings: Bindings }>();

messages.post('/', async (c) => {
  const { conversationId, message, endpoint, model } = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  // Get user's preset for this endpoint
  const preset = await getUserPreset(c.env.DB, userId, endpoint);
  
  // Stream response
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: 'message',
      data: JSON.stringify({ type: 'start' })
    });

    // Generate AI response with preset configuration
    const aiStream = await generateAIResponse({
      message,
      model: preset?.model || model,
      systemMessage: preset?.system_message,
      parameters: preset?.parameters,
      apiKey: c.env.OPENAI_API_KEY
    });

    // Stream tokens
    for await (const chunk of aiStream) {
      await stream.writeSSE({
        event: 'message',
        data: JSON.stringify({ 
          type: 'token',
          text: chunk 
        })
      });
    }

    await stream.writeSSE({
      event: 'message', 
      data: JSON.stringify({ type: 'end' })
    });
  });
});

export default messages;
```

### 5. Wrangler Configuration (wrangler.toml)

```toml
name = "librechat-backend"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[env.production]
vars = { ENVIRONMENT = "production" }

[[d1_databases]]
binding = "DB"
database_name = "librechat"
database_id = "your-database-id"

[[r2_buckets]]
binding = "R2"
bucket_name = "librechat-files"

[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"

[[vectorize]]
binding = "VECTORIZE"
index_name = "librechat-search"

[secrets]
JWT_SECRET
OPENAI_API_KEY
ANTHROPIC_API_KEY
```

### 6. Admin API for Preset Management

```typescript
// src/routes/admin/presets.ts
import { Hono } from 'hono';

const adminPresets = new Hono<{ Bindings: Bindings }>();

// Create preset
adminPresets.post('/', async (c) => {
  const preset = await c.req.json();
  
  const result = await c.env.DB.prepare(`
    INSERT INTO model_presets 
    (id, name, user_id, group_id, endpoint, model, system_message, parameters, tools, is_default, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    generateId(),
    preset.name,
    preset.userId || null,
    preset.groupId || null,
    preset.endpoint,
    preset.model,
    preset.systemMessage || null,
    JSON.stringify(preset.parameters || {}),
    JSON.stringify(preset.tools || {}),
    preset.isDefault || false,
    preset.priority || 0
  ).run();

  return c.json({ success: true, id: result.meta.last_row_id });
});

// Assign preset to user
adminPresets.post('/:presetId/assign', async (c) => {
  const { presetId } = c.req.param();
  const { userId } = await c.req.json();
  
  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO user_preset_assignments (user_id, preset_id, is_active)
    VALUES (?, ?, true)
  `).bind(userId, presetId).run();

  return c.json({ success: true });
});

export default adminPresets;
```

## Key Features Implemented

1. **JWT Authentication** - Compatible with LibreChat client
2. **Model Presets** - User and group-specific configurations
3. **SSE Streaming** - For real-time AI responses
4. **D1 Database** - Structured data storage
5. **R2 Storage** - File uploads and management
6. **KV Cache** - Fast access to frequently used data
7. **Admin API** - Manage presets and configurations

This structure provides a solid foundation for implementing a LibreChat-compatible backend on Cloudflare Workers while adding the custom preset functionality you require.