# Model Management System

This document describes the dynamic model configuration system that allows managing AI models through a database instead of hardcoded values.

## Overview

The model management system consists of:

- **Database Table**: `models` table storing model configurations
- **Repository**: `ModelRepository` for database operations
- **API Endpoints**: Dynamic model serving via `/api/models`
- **Admin API**: CRUD operations via `/api/admin/models`
- **Population Script**: Initial data setup via `scripts/populate-models.ts`

## Database Schema

The `models` table contains the following fields:

| Field                   | Type     | Description                         | Example                      |
| ----------------------- | -------- | ----------------------------------- | ---------------------------- |
| `id`                    | INTEGER  | Auto-incrementing primary key       | `1`                          |
| `name`                  | TEXT     | Human-readable model name           | `"Sonnet 4"`                 |
| `model_id`              | TEXT     | API model identifier (unique)       | `"claude-sonnet-4-20250514"` |
| `endpoint_type`         | TEXT     | Endpoint type                       | `"anthropic"` or `"openAI"`  |
| `thinking`              | BOOLEAN  | Supports reasoning/thinking         | `true`                       |
| `context_window`        | INTEGER  | Max context window (tokens)         | `200000`                     |
| `max_output`            | INTEGER  | Max output tokens                   | `64000`                      |
| `knowledge_cutoff`      | DATETIME | Knowledge cutoff date               | `"2025-03-01T00:00:00Z"`     |
| `input_price_per_mtok`  | REAL     | Input price per million tokens ($)  | `3.0`                        |
| `output_price_per_mtok` | REAL     | Output price per million tokens ($) | `15.0`                       |
| `is_active`             | BOOLEAN  | Whether model is available          | `true`                       |
| `created_at`            | DATETIME | Creation timestamp                  | Auto-generated               |
| `updated_at`            | DATETIME | Last update timestamp               | Auto-generated               |

## Default Models

The system comes with these default models:

### Anthropic Models

- **Sonnet 4** (`claude-sonnet-4-20250514`)
  - Thinking: Yes
  - Context: 200,000 tokens
  - Max Output: 64,000 tokens
  - Input: $3/MTok, Output: $15/MTok

### OpenAI Models

- **GPT-4.1** (`gpt-4.1`)

  - Thinking: No
  - Context: 128,000 tokens
  - Max Output: 4,096 tokens
  - Input: $10/MTok, Output: $30/MTok

- **GPT-4.1 Nano** (`gpt-4.1-nano`)
  - Thinking: No
  - Context: 32,000 tokens
  - Max Output: 2,048 tokens
  - Input: $2/MTok, Output: $8/MTok

## API Endpoints

### Public Endpoints

#### GET /api/models

Returns available models grouped by endpoint type. Only includes endpoints that have BOTH a configured API key AND at least one active model in the database. Returns 503 if no endpoints meet both criteria.

**Response:**

```json
{
  "anthropic": ["claude-sonnet-4-20250514"],
  "openAI": ["gpt-4.1", "gpt-4.1-nano"]
}
```

### Admin Endpoints

All admin endpoints require authentication. Add admin role checks as needed.

#### GET /api/admin/models

List all models (active and inactive).

**Response:**

```json
{
  "models": [
    {
      "id": 1,
      "name": "Sonnet 4",
      "modelId": "claude-sonnet-4-20250514",
      "endpointType": "anthropic",
      "thinking": true,
      "contextWindow": 200000,
      "maxOutput": 64000,
      "knowledgeCutoff": "2025-03-01T00:00:00Z",
      "inputPricePerMtok": 3,
      "outputPricePerMtok": 15,
      "isActive": true,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

#### GET /api/admin/models/:id

Get a specific model by database ID.

#### POST /api/admin/models

Create a new model.

**Request Body:**

```json
{
  "name": "GPT-5",
  "modelId": "gpt-5-turbo",
  "endpointType": "openAI",
  "thinking": true,
  "contextWindow": 256000,
  "maxOutput": 8192,
  "knowledgeCutoff": "2025-01-01T00:00:00Z",
  "inputPricePerMtok": 5,
  "outputPricePerMtok": 20,
  "isActive": true
}
```

#### PUT /api/admin/models/:id

Update an existing model (partial updates supported).

#### DELETE /api/admin/models/:id

Delete a model by database ID.

#### POST /api/admin/models/populate

Populate the database with default models. Skips models that already exist.

**Response:**

```json
{
  "message": "Model population completed",
  "summary": { "created": 2, "skipped": 1, "total": 3 },
  "results": [
    { "modelId": "claude-sonnet-4-20250514", "status": "created", "id": 1 },
    { "modelId": "gpt-4.1", "status": "skipped", "reason": "already exists" }
  ]
}
```

## Population Script

Use the population script to add default models:

```bash
# For local development (uses real .wrangler SQLite database)
# Prerequisites: Run `npm run dev` first to initialize database, then stop it
npx tsx scripts/populate-models.ts

# For production, use the admin API:
curl -X POST https://your-worker.workers.dev/api/admin/models/populate \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Script Features

- **Real Database**: Uses actual `.wrangler` SQLite file for local development
- **Safe**: Automatically checks for existing models and skips duplicates
- **Detailed Output**: Shows SQL queries, bindings, and comprehensive progress
- **Cross-Platform**: Works with both local SQLite and production D1 databases
- **Export Functions**: `addModel()` and `listModels()` for programmatic use

## Usage Examples

### Adding a Custom Model

```bash
curl -X POST https://your-worker.workers.dev/api/admin/models \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Custom Model",
    "modelId": "custom-model-v1",
    "endpointType": "openAI",
    "thinking": false,
    "contextWindow": 100000,
    "maxOutput": 4000,
    "inputPricePerMtok": 8,
    "outputPricePerMtok": 24,
    "isActive": true
  }'
```

### Updating Model Pricing

```bash
curl -X PUT https://your-worker.workers.dev/api/admin/models/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "inputPricePerMtok": 2.5,
    "outputPricePerMtok": 12.5
  }'
```

### Deactivating a Model

```bash
curl -X PUT https://your-worker.workers.dev/api/admin/models/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{ "isActive": false }'
```

## Database Migration

Apply the models table migration:

```sql
-- This is automatically applied when your worker starts
-- File: src/db/migrations/002_models_table.sql

CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    model_id TEXT NOT NULL UNIQUE,
    endpoint_type TEXT NOT NULL,
    thinking BOOLEAN DEFAULT FALSE,
    context_window INTEGER NOT NULL,
    max_output INTEGER NOT NULL,
    knowledge_cutoff DATETIME,
    input_price_per_mtok REAL NOT NULL,
    output_price_per_mtok REAL NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Implementation Notes

### Model Repository

- **CRUD Operations**: Full create, read, update, delete functionality
- **Filtering**: Get models by endpoint type, active status
- **Grouping**: Automatically groups models by endpoint for API response
- **Validation**: Type-safe operations with TypeScript interfaces

### Dynamic Model Serving

- **API Key Aware**: Only serves models for configured endpoints
- **Real-time**: Changes to database immediately reflect in API responses
- **Backward Compatible**: Maintains LibreChat's expected API format

### Security Considerations

- **Authentication Required**: All admin endpoints require valid OIDC token
- **Admin Role**: Add role-based checks for production use
- **Input Validation**: Comprehensive validation of model data
- **Unique Constraints**: Prevents duplicate model IDs

## Future Enhancements

Potential improvements to consider:

- **Model Versioning**: Track model version changes
- **Usage Analytics**: Monitor model usage and costs
- **Auto-discovery**: Automatically detect new models from providers
- **A/B Testing**: Support for model experimentation
- **Rate Limiting**: Per-model rate limiting configuration
- **Model Categories**: Group models by capability (chat, code, etc.)

## Troubleshooting

### Common Issues

1. **Models not appearing in /api/models**

   - Check if the endpoint has a configured API key
   - Verify the model is marked as `is_active = true`
   - Ensure the model's `endpoint_type` matches available endpoints
   - Both API key AND active models are required for an endpoint to appear

2. **Database migration not applied**

   - Check worker logs for migration errors
   - Manually run migration scripts if needed
   - Verify D1 database permissions

3. **API returns 503 "No models/endpoints available"**

   - Check that models exist in the database: `GET /api/admin/models`
   - Verify models are active: `is_active = true`
   - Ensure API keys are configured for model endpoint types
   - Use populate API if database is empty: `POST /api/admin/models/populate`

4. **Admin API returns 401/403**
   - Ensure valid OIDC authentication
   - Add admin role checks if implemented
   - Check request headers and tokens

### Debug Commands

```bash
# List all models
curl https://your-worker.workers.dev/api/admin/models \
  -H "Authorization: Bearer YOUR_TOKEN"

# Check public models endpoint
curl https://your-worker.workers.dev/api/models

# Populate with default models
curl -X POST https://your-worker.workers.dev/api/admin/models/populate \
  -H "Authorization: Bearer YOUR_TOKEN"
```
