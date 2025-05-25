import { Anthropic } from '@anthropic-ai/sdk';
import type { SSEStreamingApi } from 'hono/streaming';
import { StreamingMessage } from '../types';

export interface AnthropicStreamingOptions {
  apiKey: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  model?: string;
  maxTokens?: number;
  responseMessageId: string;
  parentMessageId: string;
  conversationId: string | null;
  onComplete?: (responseText: string, tokenCount: number) => Promise<void>;
}

/**
 * Shared Anthropic streaming service for both ask and edit endpoints
 * Handles the Anthropic API streaming and SSE event generation
 */
export class AnthropicStreamingService {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Stream a response from Anthropic and send SSE events
   * @param stream Hono SSE stream instance
   * @param options Streaming configuration options
   * @returns Promise<string> The complete response text
   */
  async streamResponse(
    stream: SSEStreamingApi,
    options: AnthropicStreamingOptions,
  ): Promise<{ responseText: string; tokenCount: number }> {
    const {
      messages,
      model = 'claude-3-5-sonnet-20241022',
      maxTokens = 4000,
      responseMessageId,
      parentMessageId,
      conversationId,
      onComplete,
    } = options;

    console.log('[AnthropicStreamingService] Starting stream:', {
      messageCount: messages.length,
      model,
      responseMessageId,
    });

    try {
      // Start streaming from Anthropic
      const anthropicStream = await this.anthropic.messages.stream({
        model,
        max_tokens: maxTokens,
        messages,
      });

      let responseText = '';
      let tokenCount = 0;

      // Process streaming response
      for await (const event of anthropicStream) {
        if (event.type === 'content_block_delta') {
          const delta = (event as any).delta;
          if (delta.type === 'text_delta') {
            responseText += delta.text;

            // Send incremental update via SSE
            await stream.writeSSE({
              data: JSON.stringify({
                text: delta.text,
                messageId: responseMessageId,
                parentMessageId,
                conversationId,
                sender: 'assistant',
              } as StreamingMessage),
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

      // Call completion callback if provided
      if (onComplete) {
        await onComplete(responseText, tokenCount);
      }

      return { responseText, tokenCount };
    } catch (error) {
      console.error('[AnthropicStreamingService] Streaming error:', error);

      let errorMessage = 'Internal server error';
      if (error instanceof Anthropic.APIError) {
        errorMessage = `Anthropic API error: ${error.message}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      // Send error via SSE
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
