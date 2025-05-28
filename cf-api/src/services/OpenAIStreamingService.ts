import OpenAI from 'openai';
import type { SSEStreamingApi } from 'hono/streaming';
import {
  StreamingMessage,
  IStreamingService,
  StreamingServiceOptions,
  StreamingServiceResponse,
} from '../types';

/**
 * OpenAI-specific streaming options that extend the base interface
 * Includes provider-specific configuration like API key
 */
export interface OpenAIStreamingOptions extends StreamingServiceOptions {
  apiKey: string;
}

/**
 * OpenAI-specific implementation of the streaming service interface
 * Handles GPT API streaming and SSE event generation
 * Matches LibreChat's expected SSE format for frontend compatibility
 */
export class OpenAIStreamingService implements IStreamingService {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Static factory method to create an OpenAIStreamingService instance
   * @param apiKey OpenAI API key for authentication
   * @returns A new OpenAIStreamingService instance
   */
  static create(apiKey: string): OpenAIStreamingService {
    return new OpenAIStreamingService(apiKey);
  }

  /**
   * Stream a response from OpenAI and send SSE events in LibreChat format
   * @param stream Hono SSE stream instance for sending real-time updates
   * @param options Streaming configuration options including messages, model, and callbacks
   * @returns Promise containing the complete response text and token count
   */
  async streamResponse(
    stream: SSEStreamingApi,
    options: StreamingServiceOptions,
  ): Promise<StreamingServiceResponse> {
    const {
      messages,
      model = 'gpt-4.1',
      maxTokens = 4000,
      responseMessageId,
      parentMessageId,
      conversationId,
    } = options;

    console.log('[OpenAIStreamingService] Starting stream:', {
      messageCount: messages.length,
      model,
      responseMessageId,
    });

    try {
      // Generate a step ID for the run step event (matches LibreChat format)
      const stepId = `step_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`;
      const runId = crypto.randomUUID();

      // Send initial run step event (matches LibreChat's on_run_step format)
      await stream.writeSSE({
        data: JSON.stringify({
          event: 'on_run_step',
          data: {
            id: stepId,
            runId: runId,
            type: 'message_creation',
            index: 0,
            stepDetails: {
              type: 'message_creation',
              message_creation: {
                message_id: responseMessageId,
              },
            },
          },
        }),
        event: 'message',
      });

      // Convert messages to OpenAI format with proper typing
      const openaiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map((msg, index) => {
        if (typeof msg.content === 'string') {
          // Simple text message
          console.log(`[OpenAI Streaming] Message ${index}: text-only`, {
            role: msg.role,
            contentLength: msg.content.length,
          });
          return {
            role: msg.role,
            content: msg.content,
          } as OpenAI.ChatCompletionMessageParam;
        } else {
          // Complex content with images/mixed types - already in correct OpenAI format
          console.log(`[OpenAI Streaming] Message ${index}: complex content`, {
            role: msg.role,
            contentType: Array.isArray(msg.content) ? 'array' : typeof msg.content,
            contentLength: Array.isArray(msg.content) ? msg.content.length : 'N/A',
            contentStructure: Array.isArray(msg.content)
              ? msg.content.map((item, i) => ({ index: i, type: (item as any).type }))
              : 'N/A',
          });
          return {
            role: msg.role,
            content: msg.content, // Already formatted correctly for OpenAI vision
          } as OpenAI.ChatCompletionMessageParam;
        }
      });

      console.log(`[OpenAI Streaming] Sending ${openaiMessages.length} messages to OpenAI`, {
        model,
        visionRequest: openaiMessages.some((msg) => Array.isArray(msg.content)),
        maxTokens,
        detailedMessages: openaiMessages.map((msg, idx) => ({
          index: idx,
          role: msg.role,
          contentType: Array.isArray(msg.content) ? 'array' : typeof msg.content,
          contentDetails: Array.isArray(msg.content)
            ? msg.content.map((item: any, i: number) => ({
                index: i,
                type: item.type,
                hasText: !!item.text,
                hasImageUrl: !!item.image_url,
                textLength: item.text?.length || 0,
                imageUrlDetail: item.image_url?.detail,
                imageUrlLength: item.image_url?.url?.length || 0,
              }))
            : { textLength: (msg.content as string)?.length || 0 },
        })),
      });

      // Start streaming from OpenAI
      console.log('[OpenAI Streaming] Making OpenAI API call...');
      const openaiStream = await this.openai.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: openaiMessages,
        stream: true,
      });

      console.log('[OpenAI Streaming] OpenAI API call successful, starting to process stream...');

      let responseText = '';
      let tokenCount = 0;

      // Process streaming response
      for await (const chunk of openaiStream) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          responseText += delta.content;

          // Send delta event in LibreChat format (matches on_message_delta)
          await stream.writeSSE({
            data: JSON.stringify({
              event: 'on_message_delta',
              data: {
                id: stepId,
                delta: {
                  content: [
                    {
                      type: 'text',
                      text: delta.content,
                    },
                  ],
                },
              },
            }),
            event: 'message',
          });
        }

        // Extract token usage from final chunk
        if (chunk.usage) {
          tokenCount = chunk.usage.completion_tokens || 0;
        }
      }

      console.log('[OpenAIStreamingService] Stream completed:', {
        responseLength: responseText.length,
        tokenCount,
      });

      // Note: Completion handling is now managed by SseService

      return { responseText, tokenCount };
    } catch (error) {
      console.error('[OpenAIStreamingService] Streaming error:', error);

      let errorMessage = 'Internal server error';
      if (error instanceof OpenAI.APIError) {
        errorMessage = `OpenAI API error: ${error.message}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      // Send error via SSE in LibreChat format
      await stream.writeSSE({
        data: JSON.stringify({
          error: true,
          text: errorMessage,
          messageId: responseMessageId,
          conversationId,
        } as StreamingMessage),
        event: 'error',
      });

      throw error;
    }
  }
}
