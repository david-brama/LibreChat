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
 * Inferred types from zod schemas - these guarantee compatibility with LibreChat frontend
 */
export type Message = z.infer<typeof tMessageSchema>;
export type Conversation = z.infer<typeof tConversationSchema>;

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
 * For MVP: only contains anthropic endpoint
 */
export interface EndpointsConfig {
  anthropic: EndpointConfig;
}

/**
 * Models configuration object
 * Maps endpoint names to arrays of available model names
 * For MVP: only contains anthropic with claude-sonnet-4-20250514
 */
export interface ModelsConfig {
  anthropic: string[];
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
}

export interface UpdateMessageDTO {
  text?: string;
  error?: boolean;
  finishReason?: string;
  tokenCount?: number;
  metadata?: Record<string, any>;
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
  model: string;
  key: string;
  isContinued: boolean;
  isTemporary: boolean;
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
