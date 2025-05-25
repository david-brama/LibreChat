-- LibreChat D1 Database Schema
-- This schema defines the structure for conversations and messages
-- Compatible with LibreChat's data model but optimized for D1

-- Conversations table
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

-- Messages table
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

-- Indexes for performance
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

-- Search optimization indexes
CREATE INDEX IF NOT EXISTS idx_conversations_title_search ON conversations(user_id, title);
CREATE INDEX IF NOT EXISTS idx_messages_text_search ON messages(conversation_id, text); 