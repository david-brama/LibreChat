/**
 * TypeScript type definitions for LibreChat Cloudflare backend
 * Based on librechat-data-provider schemas
 */

import { z } from 'zod';

/**
 * Import zod schemas from librechat-data-provider for type inference
 * This ensures our API responses exactly match the expected client types
 */

// Define the schemas we need to infer from
// These should match the schemas from packages/data-provider/src/schemas.ts
export const tMessageSchema = z.object({
  messageId: z.string(),
  endpoint: z.string().optional(),
  clientId: z.string().nullable().optional(),
  conversationId: z.string().nullable(),
  parentMessageId: z.string().nullable(),
  responseMessageId: z.string().nullable().optional(),
  overrideParentMessageId: z.string().nullable().optional(),
  bg: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  title: z.string().nullable().or(z.literal('New Chat')).default('New Chat').optional(),
  sender: z.string().optional(),
  text: z.string(),
  generation: z.string().nullable().optional(),
  isCreatedByUser: z.boolean(),
  error: z.boolean().optional(),
  clientTimestamp: z.string().optional(),
  createdAt: z
    .string()
    .optional()
    .default(() => new Date().toISOString()),
  updatedAt: z
    .string()
    .optional()
    .default(() => new Date().toISOString()),
  current: z.boolean().optional(),
  unfinished: z.boolean().optional(),
  searchResult: z.boolean().optional(),
  finish_reason: z.string().optional(),
  /* assistant */
  thread_id: z.string().optional(),
  /* frontend components */
  iconURL: z.string().nullable().optional(),
  /* additional fields for our implementation */
  user: z.string().optional(),
  tokenCount: z.number().nullable().optional(),
  metadata: z.record(z.any()).optional(),
  /* files */
  files: z
    .array(
      z.object({
        type: z.string(),
        file_id: z.string(),
        filepath: z.string(),
        filename: z.string(),
        embedded: z.boolean(),
        metadata: z.any().nullable(),
        height: z.number().optional(),
        width: z.number().optional(),
      }),
    )
    .optional(),
});

export const tConversationSchema = z.object({
  conversationId: z.string().nullable(),
  endpoint: z.string().nullable().optional(),
  endpointType: z.string().nullable().optional(),
  isArchived: z.boolean().optional(),
  title: z.string().nullable().or(z.literal('New Chat')).default('New Chat'),
  user: z.string().optional(),
  messages: z.array(z.string()).optional(),
  tools: z.array(z.any()).optional(),
  modelLabel: z.string().nullable().optional(),
  userLabel: z.string().optional(),
  model: z.string().nullable().optional(),
  promptPrefix: z.string().nullable().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  top_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  parentMessageId: z.string().optional(),
  maxOutputTokens: z.number().optional(),
  maxContextTokens: z.number().optional(),
  max_tokens: z.number().optional(),
  /* Anthropic */
  promptCache: z.boolean().optional(),
  system: z.string().optional(),
  thinking: z.boolean().optional(),
  thinkingBudget: z.number().optional(),
  /* artifacts */
  artifacts: z.string().optional(),
  /* google */
  context: z.string().nullable().optional(),
  examples: z.array(z.any()).optional(),
  /* DB */
  tags: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /* Files */
  resendFiles: z.boolean().optional(),
  file_ids: z.array(z.string()).optional(),
  /* vision */
  imageDetail: z.string().optional(),
  /* OpenAI: o1 only */
  reasoning_effort: z.string().optional(),
  /* assistant */
  assistant_id: z.string().optional(),
  /* agents */
  agent_id: z.string().optional(),
  /* AWS Bedrock */
  region: z.string().optional(),
  maxTokens: z.number().optional(),
  additionalModelRequestFields: z.record(z.any()).optional(),
  /* assistants */
  instructions: z.string().optional(),
  additional_instructions: z.string().optional(),
  append_current_datetime: z.boolean().optional(),
  /** Used to overwrite active conversation settings when saving a Preset */
  presetOverride: z.record(z.unknown()).optional(),
  stop: z.array(z.string()).optional(),
  /* frontend components */
  greeting: z.string().optional(),
  spec: z.string().nullable().optional(),
  iconURL: z.string().nullable().optional(),
  /* temporary chat */
  expiredAt: z.string().nullable().optional(),
  /** @deprecated */
  resendImages: z.boolean().optional(),
  /** @deprecated */
  agentOptions: z.any().nullable().optional(),
  /** @deprecated Prefer `modelLabel` over `chatGptLabel` */
  chatGptLabel: z.string().nullable().optional(),
});

/**
 * File schema for LibreChat compatibility
 */
export const tFileSchema = z.object({
  _id: z.string().optional(),
  file_id: z.string(),
  temp_file_id: z.string().optional(),
  user: z.string(),
  filename: z.string(),
  filepath: z.string(),
  type: z.string(),
  bytes: z.number(),
  source: z.string().default('r2'),
  width: z.number().optional(),
  height: z.number().optional(),
  embedded: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

/**
 * Inferred types from zod schemas - these guarantee compatibility with LibreChat frontend
 */
export type Message = z.infer<typeof tMessageSchema>;
export type Conversation = z.infer<typeof tConversationSchema>;
export type File = z.infer<typeof tFileSchema>;

/**
 * File upload response type (LibreChat compatible)
 */
export interface TFileUpload extends File {
  temp_file_id: string;
}

/**
 * File configuration for endpoints
 */
export interface EndpointFileConfig {
  fileLimit: number;
  fileSizeLimit: number;
  totalSizeLimit: number;
  supportedMimeTypes: string[];
}

/**
 * File configuration object
 */
export interface FileConfig {
  endpoints: {
    anthropic?: EndpointFileConfig;
    openAI?: EndpointFileConfig;
  };
  serverFileSizeLimit: number;
  avatarSizeLimit: number;
}

/**
 * Image content types for AI providers
 */
export interface ImageContentOpenAI {
  type: 'image_url';
  image_url: {
    url: string;
    detail: 'auto' | 'low' | 'high';
  };
}

export interface ImageContentAnthropic {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export type ImageContent = ImageContentOpenAI | ImageContentAnthropic;

/**
 * Minimal endpoint configuration for MVP
 * Supporting only Anthropic Claude Sonnet 4.0
 */
export interface EndpointConfig {
  order: number;
  type?: string;
  userProvide?: boolean;
  userProvideURL?: boolean;
}

/**
 * Endpoints configuration object
 * Supports both Anthropic and OpenAI endpoints
 */
export interface EndpointsConfig {
  anthropic?: EndpointConfig;
  openAI?: EndpointConfig;
}

/**
 * Models configuration object
 * Maps endpoint names to arrays of available model names
 * Supports both Anthropic and OpenAI endpoints
 */
export interface ModelsConfig {
  anthropic?: string[];
  openAI?: string[];
}

// Conversation type now inferred from zod schema above

// Message type now inferred from zod schema above

/**
 * API Query Parameters
 */
export interface ConversationListParams {
  cursor?: string;
  limit?: number;
  isArchived?: boolean;
  tags?: string[];
  search?: string;
  order?: 'asc' | 'desc';
}

/**
 * API Response Types
 */
export interface ConversationListResponse {
  conversations: Conversation[];
  nextCursor: string | null;
}

/**
 * Database Row Types (how data is stored in D1)
 */
export interface ConversationRow {
  id: string; // conversationId
  user_id: string;
  title: string;
  endpoint: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
  is_archived: boolean;
  settings: string; // JSON: temperature, top_p, etc.
  tags: string; // JSON array
  metadata: string; // JSON: iconURL, greeting, spec, etc.
}

export interface MessageRow {
  id: string; // messageId
  conversation_id: string;
  parent_message_id: string | null;
  user_id: string;
  sender: string;
  text: string;
  is_created_by_user: boolean;
  model: string | null;
  error: boolean;
  finish_reason: string | null;
  token_count: number | null;
  created_at: string;
  updated_at: string;
  metadata: string; // JSON: files, plugins, etc.
}

/**
 * File database row type
 */
export interface FileRow {
  id: number;
  file_id: string;
  temp_file_id: string | null;
  user_id: string;
  conversation_id: string | null;
  filename: string;
  filepath: string;
  type: string;
  bytes: number;
  source: string;
  context: string;
  width: number | null;
  height: number | null;
  metadata: string; // JSON
  usage_count: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Create/Update DTOs
 */
export interface CreateConversationDTO {
  conversationId: string;
  userId: string;
  title?: string;
  endpoint?: string;
  model?: string;
  settings?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface UpdateConversationDTO {
  title?: string;
  endpoint?: string;
  model?: string;
  isArchived?: boolean;
  tags?: string[];
  settings?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface CreateMessageDTO {
  messageId: string;
  conversationId: string;
  parentMessageId?: string;
  userId: string;
  sender: string;
  text: string;
  isCreatedByUser: boolean;
  model?: string;
  error?: boolean;
  finishReason?: string;
  tokenCount?: number;
  metadata?: Record<string, any>;
  fileIds?: string[];
}

export interface UpdateMessageDTO {
  text?: string;
  error?: boolean;
  finishReason?: string;
  tokenCount?: number;
  metadata?: Record<string, any>;
}

/**
 * File DTOs
 */
export interface CreateFileDTO {
  file_id: string;
  temp_file_id?: string;
  user_id: string;
  conversation_id?: string;
  filename: string;
  filepath: string;
  type: string;
  bytes: number;
  source?: string;
  context?: string;
  width?: number;
  height?: number;
  metadata?: Record<string, any>;
  expires_at?: string;
}

export interface UpdateFileDTO {
  filename?: string;
  filepath?: string;
  type?: string;
  bytes?: number;
  width?: number;
  height?: number;
  metadata?: Record<string, any>;
  usage_count?: number;
  expires_at?: string;
}

/**
 * LibreChat Ask API Request Types
 */
export interface AskRequest {
  text: string;
  sender: string;
  clientTimestamp: string;
  isCreatedByUser: boolean;
  parentMessageId: string;
  conversationId: string | null;
  messageId: string;
  error: boolean;
  generation: string;
  responseMessageId: string | null;
  overrideParentMessageId: string | null;
  endpoint: string;
  endpointType: string;
  model: string; // Keep for backward compatibility
  spec?: string; // New spec field - the unique name from modelSpecs
  key: string;
  isContinued: boolean;
  isTemporary: boolean;
  files?: Array<{ file_id: string }>;
}

/**
 * Streaming response types for SSE
 */
export interface StreamingMessage {
  final?: boolean;
  conversation?: Conversation;
  title?: string;
  requestMessage?: Message;
  responseMessage?: Message;
  error?: boolean;
  text?: string;
  messageId?: string;
  parentMessageId?: string;
  conversationId?: string;
  sender?: string;
}

/**
 * Generalized streaming service interface for AI providers
 * Defines the contract for any streaming AI service implementation
 */
export interface StreamingServiceOptions {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string; source?: any; image_url?: any }>;
  }>;
  model?: string;
  maxTokens?: number;
  responseMessageId: string;
  parentMessageId: string;
  conversationId: string | null;
  fileIds?: string[];
  userId?: string;

  // Model preset parameters
  systemMessage?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  promptCache?: boolean;
  thinkingBudget?: number;
}

/**
 * Return type for streaming service responses
 */
export interface StreamingServiceResponse {
  responseText: string;
  tokenCount: number;
}

/**
 * Base interface for AI streaming services
 * Provides a standardized way to stream responses from different AI providers
 * while maintaining LibreChat frontend compatibility
 */
export interface IStreamingService {
  /**
   * Stream a response from the AI provider and send SSE events in LibreChat format
   * @param stream Hono SSE stream instance for sending real-time updates
   * @param options Streaming configuration options including messages, model, and callbacks
   * @returns Promise containing the complete response text and token count
   */
  streamResponse(
    stream: import('hono/streaming').SSEStreamingApi,
    options: StreamingServiceOptions,
  ): Promise<StreamingServiceResponse>;
}

/**
 * Model configuration interface for modelSpecs
 * Represents an AI model with its capabilities, pricing, and preset configuration
 */
export interface Model {
  id: number;
  name: string;
  modelId: string;
  endpointType: 'openAI' | 'anthropic';
  thinking: boolean;
  vision: boolean;
  contextWindow: number;
  maxOutput: number;
  knowledgeCutoff: string | null;
  inputPricePerMtok: number;
  outputPricePerMtok: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;

  // New modelSpecs fields
  spec: string; // Unique spec name (indexed)
  label: string; // Human-readable label
  description?: string; // Model description
  iconUrl?: string; // Icon URL
  isDefault: boolean; // Whether this is the default model
  sortOrder: number; // Sort order for display
  systemMessage?: string; // System message for pre-defined behavior

  // Flattened preset fields
  modelLabel?: string; // Model label from preset
  promptPrefix?: string; // Prompt prefix from preset
  temperature?: number; // Temperature parameter
  topP?: number; // Top P parameter
  topK?: number; // Top K parameter (for Anthropic)
  frequencyPenalty?: number; // Frequency penalty (for OpenAI)
  presencePenalty?: number; // Presence penalty (for OpenAI)
  maxTokens?: number; // Max tokens override
  stopSequences?: string[]; // Stop sequences
  reasoningEffort?: string; // Reasoning effort for omni models
  resendFiles?: boolean; // Whether to resend files
  promptCache?: boolean; // Whether to use prompt cache
  thinkingBudget?: number; // Thinking budget for Anthropic
}

/**
 * Database row type for models table
 */
export interface ModelRow {
  id: number;
  name: string;
  model_id: string;
  endpoint_type: string;
  thinking: boolean;
  vision: boolean;
  context_window: number;
  max_output: number;
  knowledge_cutoff: string | null;
  input_price_per_mtok: number;
  output_price_per_mtok: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;

  // New modelSpecs fields
  spec: string;
  label: string;
  description: string | null;
  icon_url: string | null;
  is_default: boolean;
  sort_order: number;
  system_message: string | null;

  // Flattened preset fields
  model_label: string | null;
  prompt_prefix: string | null;
  temperature: number | null;
  top_p: number | null;
  top_k: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  max_tokens: number | null;
  stop_sequences: string | null; // JSON array
  reasoning_effort: string | null;
  resend_files: boolean;
  prompt_cache: boolean;
  thinking_budget: number | null;
}

/**
 * DTO for creating a new model with modelSpecs structure
 */
export interface CreateModelDTO {
  name: string;
  modelId: string;
  endpointType: 'openAI' | 'anthropic';
  thinking?: boolean;
  vision?: boolean;
  contextWindow: number;
  maxOutput: number;
  knowledgeCutoff?: string;
  inputPricePerMtok: number;
  outputPricePerMtok: number;
  isActive?: boolean;

  // New modelSpecs fields
  spec: string; // Required unique spec name
  label: string; // Required human-readable label
  description?: string;
  iconUrl?: string;
  isDefault?: boolean;
  sortOrder?: number;
  systemMessage?: string;

  // Optional preset fields
  modelLabel?: string;
  promptPrefix?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxTokens?: number;
  stopSequences?: string[];
  reasoningEffort?: string;
  resendFiles?: boolean;
  promptCache?: boolean;
  thinkingBudget?: number;
}

/**
 * DTO for updating an existing model
 */
export interface UpdateModelDTO {
  name?: string;
  modelId?: string;
  endpointType?: 'openAI' | 'anthropic';
  thinking?: boolean;
  vision?: boolean;
  contextWindow?: number;
  maxOutput?: number;
  knowledgeCutoff?: string;
  inputPricePerMtok?: number;
  outputPricePerMtok?: number;
  isActive?: boolean;

  // New modelSpecs fields
  spec?: string;
  label?: string;
  description?: string;
  iconUrl?: string;
  isDefault?: boolean;
  sortOrder?: number;
  systemMessage?: string;

  // Optional preset fields
  modelLabel?: string;
  promptPrefix?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxTokens?: number;
  stopSequences?: string[];
  reasoningEffort?: string;
  resendFiles?: boolean;
  promptCache?: boolean;
  thinkingBudget?: number;
}

/**
 * File processing result for image encoding
 */
export interface FileProcessingResult {
  text: string;
  files: File[];
  image_urls: ImageContent[];
}
