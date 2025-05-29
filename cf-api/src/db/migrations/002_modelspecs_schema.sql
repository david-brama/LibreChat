-- Migration 002: Add modelSpecs schema to models table
-- This migration adds fields for the modelSpecs system instead of endpoints

-- Add new modelSpecs fields
ALTER TABLE models ADD COLUMN spec TEXT;
ALTER TABLE models ADD COLUMN label TEXT;
ALTER TABLE models ADD COLUMN description TEXT;
ALTER TABLE models ADD COLUMN icon_url TEXT;
ALTER TABLE models ADD COLUMN is_default BOOLEAN DEFAULT FALSE;
ALTER TABLE models ADD COLUMN sort_order INTEGER DEFAULT 0;

-- Add system message field for pre-defined behavior
ALTER TABLE models ADD COLUMN system_message TEXT;

-- Add flattened preset fields
ALTER TABLE models ADD COLUMN model_label TEXT;
ALTER TABLE models ADD COLUMN prompt_prefix TEXT;
ALTER TABLE models ADD COLUMN temperature REAL;
ALTER TABLE models ADD COLUMN top_p REAL;
ALTER TABLE models ADD COLUMN top_k INTEGER;
ALTER TABLE models ADD COLUMN frequency_penalty REAL;
ALTER TABLE models ADD COLUMN presence_penalty REAL;
ALTER TABLE models ADD COLUMN max_tokens INTEGER;
ALTER TABLE models ADD COLUMN stop_sequences TEXT; -- JSON array
ALTER TABLE models ADD COLUMN reasoning_effort TEXT;
ALTER TABLE models ADD COLUMN resend_files BOOLEAN DEFAULT FALSE;
ALTER TABLE models ADD COLUMN prompt_cache BOOLEAN DEFAULT FALSE;
ALTER TABLE models ADD COLUMN thinking_budget INTEGER;

-- Create indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_models_spec ON models(spec);
CREATE INDEX IF NOT EXISTS idx_models_endpoint_active ON models(endpoint_type, is_active);
CREATE INDEX IF NOT EXISTS idx_models_default ON models(is_default);
CREATE INDEX IF NOT EXISTS idx_models_sort_order ON models(sort_order); 