import { Anthropic } from '@anthropic-ai/sdk';
import type { SSEStreamingApi } from 'hono/streaming';
import {
  StreamingMessage,
  IStreamingService,
  StreamingServiceOptions,
  StreamingServiceResponse,
} from '../types';

/**
 * Anthropic-specific streaming options that extend the base interface
 * Includes provider-specific configuration like API key
 */
export interface AnthropicStreamingOptions extends StreamingServiceOptions {
  apiKey: string;
}

/**
 * Anthropic-specific implementation of the streaming service interface
 * Handles Claude API streaming and SSE event generation
 * Matches LibreChat's expected SSE format for frontend compatibility
 */
export class AnthropicStreamingService implements IStreamingService {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Static factory method to create an AnthropicStreamingService instance
   * @param apiKey Anthropic API key for authentication
   * @returns A new AnthropicStreamingService instance
   */
  static create(apiKey: string): AnthropicStreamingService {
    return new AnthropicStreamingService(apiKey);
  }

  /**
   * Stream a response from Anthropic and send SSE events in LibreChat format
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
      model = 'claude-sonnet-4-20250514',
      maxTokens = 4000,
      responseMessageId,
      parentMessageId,
      conversationId,
    } = options;

    console.log('[AnthropicStreamingService] Starting stream:', {
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

      // Convert messages to Anthropic format with proper typing
      const anthropicMessages: Anthropic.MessageParam[] = messages.map((msg) => {
        if (typeof msg.content === 'string') {
          // Simple text message
          return {
            role: msg.role,
            content: msg.content,
          };
        } else {
          // Complex content with images/mixed types
          return {
            role: msg.role,
            content: msg.content as any, // Anthropic SDK will handle the content array
          };
        }
      });

      // Start streaming from Anthropic
      const anthropicStream = await this.anthropic.messages.stream({
        model,
        max_tokens: maxTokens,
        messages: anthropicMessages,
      });

      let responseText = '';
      let tokenCount = 0;

      // Process streaming response
      for await (const event of anthropicStream) {
        if (event.type === 'content_block_delta') {
          const delta = (event as any).delta;
          if (delta.type === 'text_delta') {
            responseText += delta.text;

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
                        text: delta.text,
                      },
                    ],
                  },
                },
              }),
              event: 'message',
            });
          }
        } else if (event.type === 'message_delta') {
          const delta = (event as any).delta;
          if (delta.usage) {
            tokenCount = delta.usage.output_tokens || 0;
          }
        }
      }

      console.log('[AnthropicStreamingService] Stream completed:', {
        responseLength: responseText.length,
        tokenCount,
      });

      // Note: Completion handling is now managed by SseService

      return { responseText, tokenCount };
    } catch (error) {
      console.error('[AnthropicStreamingService] Streaming error:', error);

      let errorMessage = 'Internal server error';
      if (error instanceof Anthropic.APIError) {
        errorMessage = `Anthropic API error: ${error.message}`;
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
