-- LibreChat D1 Database Schema
-- This schema defines the complete structure for LibreChat on Cloudflare D1
-- Compatible with LibreChat's data model but optimized for D1
-- Consolidated schema including all features: conversations, messages, models, files, and relationships

-- =============================================================================
-- CONVERSATIONS TABLE
-- =============================================================================
-- Stores conversation metadata and settings
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,                    -- conversationId
    user_id TEXT NOT NULL,                  -- User who owns the conversation
    title TEXT DEFAULT 'New Chat',          -- Conversation title
    endpoint TEXT,                          -- AI endpoint (openai, anthropic, etc.)
    model TEXT,                             -- AI model used
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_archived BOOLEAN DEFAULT FALSE,      -- Whether conversation is archived
    -- JSON fields for flexible storage
    settings TEXT DEFAULT '{}',             -- Model parameters (temperature, top_p, etc.)
    tags TEXT DEFAULT '[]',                 -- Array of conversation tags
    metadata TEXT DEFAULT '{}'              -- Additional metadata (iconURL, greeting, spec, etc.)
);

-- =============================================================================
-- MESSAGES TABLE
-- =============================================================================
-- Stores individual messages within conversations
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,                    -- messageId
    conversation_id TEXT NOT NULL,          -- Foreign key to conversations.id
    parent_message_id TEXT,                 -- Parent message for threading
    user_id TEXT NOT NULL,                  -- User who owns the message
    sender TEXT NOT NULL,                   -- 'user' or 'assistant'
    text TEXT NOT NULL,                     -- Message content
    is_created_by_user BOOLEAN NOT NULL,    -- Whether message was created by user
    model TEXT,                             -- AI model used for this message
    error BOOLEAN DEFAULT FALSE,            -- Whether message has an error
    finish_reason TEXT,                     -- Completion reason (stop, length, etc.)
    token_count INTEGER,                    -- Number of tokens in message
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- JSON field for additional data
    metadata TEXT DEFAULT '{}',             -- Files, plugins, tool calls, etc.
    
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- =============================================================================
-- MODELS TABLE
-- =============================================================================
-- Stores AI model configurations and capabilities
-- Allows dynamic model serving instead of hardcoded values
CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Auto-incrementing primary key
    name TEXT NOT NULL,                    -- Human-readable model name (e.g., "Sonnet 4")
    model_id TEXT NOT NULL UNIQUE,         -- API model identifier (e.g., "claude-sonnet-4-20250514")
    endpoint_type TEXT NOT NULL,           -- Endpoint type: "openAI" or "anthropic"
    thinking BOOLEAN DEFAULT FALSE,        -- Whether model supports thinking/reasoning
    vision BOOLEAN DEFAULT FALSE,          -- Whether model supports vision/image input
    context_window INTEGER NOT NULL,       -- Maximum context window in tokens
    max_output INTEGER NOT NULL,           -- Maximum output tokens
    knowledge_cutoff DATETIME,             -- Knowledge cutoff date
    input_price_per_mtok REAL NOT NULL,    -- Input price per million tokens ($)
    output_price_per_mtok REAL NOT NULL,   -- Output price per million tokens ($)
    is_active BOOLEAN DEFAULT TRUE,        -- Whether model is available for use
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- FILES TABLE
-- =============================================================================
-- Stores file attachments with R2 storage support
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id TEXT NOT NULL UNIQUE,        -- UUID for the file
    temp_file_id TEXT,                    -- Temporary ID from client
    user_id TEXT NOT NULL,                -- User who owns the file
    conversation_id TEXT,                 -- Optional conversation reference
    filename TEXT NOT NULL,               -- Original filename
    filepath TEXT NOT NULL,               -- R2 object key
    type TEXT NOT NULL,                   -- MIME type
    bytes INTEGER NOT NULL,               -- File size
    source TEXT DEFAULT 'r2',             -- Storage source
    context TEXT DEFAULT 'message_attachment', -- Usage context
    
    -- Image-specific fields
    width INTEGER,                        -- Image width
    height INTEGER,                       -- Image height
    
    -- Metadata and tracking
    metadata TEXT DEFAULT '{}',           -- JSON metadata
    usage_count INTEGER DEFAULT 0,        -- Track file usage
    expires_at DATETIME,                  -- Optional expiration
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

-- =============================================================================
-- MESSAGE-FILES RELATIONSHIP TABLE
-- =============================================================================
-- Junction table for many-to-many relationship between messages and files
CREATE TABLE IF NOT EXISTS message_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,              -- Foreign key to messages.id
    file_id TEXT NOT NULL,                 -- Foreign key to files.file_id
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure no duplicate associations
    UNIQUE(message_id, file_id),
    
    -- Foreign key constraints
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE
);

-- =============================================================================
-- TRIGGERS
-- =============================================================================
-- Update trigger for files table
CREATE TRIGGER IF NOT EXISTS update_files_updated_at
    AFTER UPDATE ON files
    FOR EACH ROW
BEGIN
    UPDATE files SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- Conversation indexes
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_user_archived ON conversations(user_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);

-- Message indexes  
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

-- Model indexes
CREATE INDEX IF NOT EXISTS idx_models_endpoint_type ON models(endpoint_type);
CREATE INDEX IF NOT EXISTS idx_models_active ON models(is_active);
CREATE INDEX IF NOT EXISTS idx_models_endpoint_active ON models(endpoint_type, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_models_model_id ON models(model_id);

-- Files indexes
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_file_id ON files(file_id);
CREATE INDEX IF NOT EXISTS idx_files_conversation_id ON files(conversation_id);
CREATE INDEX IF NOT EXISTS idx_files_user_created ON files(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files(expires_at);

-- Message-files relationship indexes
CREATE INDEX IF NOT EXISTS idx_message_files_message_id ON message_files(message_id);
CREATE INDEX IF NOT EXISTS idx_message_files_file_id ON message_files(file_id);
CREATE INDEX IF NOT EXISTS idx_message_files_created_at ON message_files(created_at);

-- Search optimization indexes
CREATE INDEX IF NOT EXISTS idx_conversations_title_search ON conversations(user_id, title);
CREATE INDEX IF NOT EXISTS idx_messages_text_search ON messages(conversation_id, text); 