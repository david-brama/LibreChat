-- Models table migration
-- Stores AI model configurations and capabilities
-- Allows dynamic model serving instead of hardcoded values

CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Auto-incrementing primary key
    name TEXT NOT NULL,                    -- Human-readable model name (e.g., "Sonnet 4")
    model_id TEXT NOT NULL UNIQUE,         -- API model identifier (e.g., "claude-sonnet-4-20250514")
    endpoint_type TEXT NOT NULL,           -- Endpoint type: "openAI" or "anthropic"
    thinking BOOLEAN DEFAULT FALSE,        -- Whether model supports thinking/reasoning
    context_window INTEGER NOT NULL,       -- Maximum context window in tokens
    max_output INTEGER NOT NULL,           -- Maximum output tokens
    knowledge_cutoff DATETIME,             -- Knowledge cutoff date
    input_price_per_mtok REAL NOT NULL,    -- Input price per million tokens ($)
    output_price_per_mtok REAL NOT NULL,   -- Output price per million tokens ($)
    is_active BOOLEAN DEFAULT TRUE,        -- Whether model is available for use
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_models_endpoint_type ON models(endpoint_type);
CREATE INDEX IF NOT EXISTS idx_models_active ON models(is_active);
CREATE INDEX IF NOT EXISTS idx_models_endpoint_active ON models(endpoint_type, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_models_model_id ON models(model_id); 