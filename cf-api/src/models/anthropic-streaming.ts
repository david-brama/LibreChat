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
 * Matches LibreChat's expected SSE format for frontend compatibility
 */
export class AnthropicStreamingService {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Stream a response from Anthropic and send SSE events in LibreChat format
   * @param stream Hono SSE stream instance
   * @param options Streaming configuration options
   * @returns Promise<{responseText: string, tokenCount: number}> The complete response data
   */
  async streamResponse(
    stream: SSEStreamingApi,
    options: AnthropicStreamingOptions,
  ): Promise<{ responseText: string; tokenCount: number }> {
    const {
      messages,
      model = 'claude-sonnet-4-20250514',
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

/**
 * Service for generating conversation titles using Anthropic Claude 3.5 Haiku
 * Optimized for fast, cost-effective title generation
 */
export class AnthropicTitleService {
  private anthropic: Anthropic;
  private readonly TITLE_MODEL = 'claude-3-5-haiku-20241022';

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Generate a concise title for a conversation
   * @param userText The user's input message
   * @param responseText The AI's response message
   * @returns Promise<string> Generated title or fallback
   */
  async generateTitle(userText: string, responseText: string): Promise<string> {
    try {
      console.log('[AnthropicTitleService] Generating title for conversation');
      console.log(
        '[AnthropicTitleService] Input lengths - user:',
        userText.length,
        'response:',
        responseText.length,
      );

      // Truncate texts to prevent token overflow
      const truncatedUserText = this.truncateText(userText, 500);
      const truncatedResponseText = this.truncateText(responseText, 800);

      console.log(
        '[AnthropicTitleService] Truncated lengths - user:',
        truncatedUserText.length,
        'response:',
        truncatedResponseText.length,
      );

      const systemPrompt = `Generate a concise, 5-word-or-less title for this conversation. The title should:
- Capture the main topic or theme
- Use title case (First Letter Capitalized)
- Contain no punctuation or quotation marks
- Be in the same language as the conversation
- Never directly mention "title" or the language name

Respond with ONLY the title text, nothing else.`;

      const userPrompt = `<conversation>
<user_message>
${truncatedUserText}
</user_message>
<assistant_response>
${truncatedResponseText}
</assistant_response>
</conversation>

Generate a title for this conversation:`;

      console.log('[AnthropicTitleService] Making API call to Anthropic...');

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Title generation timeout after 15 seconds')), 15000);
      });

      const apiPromise = this.anthropic.messages.create({
        model: this.TITLE_MODEL,
        max_tokens: 32,
        temperature: 0.3,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      const response = await Promise.race([apiPromise, timeoutPromise]);

      console.log('[AnthropicTitleService] Received response from Anthropic');

      // Extract text from response, ensuring it's a text block
      const contentBlock = response.content[0];
      if (contentBlock.type !== 'text') {
        console.warn('[AnthropicTitleService] Unexpected response type:', contentBlock.type);
        return 'New Chat';
      }

      const title = contentBlock.text
        .trim()
        .replace(/^["']|["']$/g, '') // Remove surrounding quotes
        .replace(/[^\w\s'-]/g, '') // Remove special characters except apostrophes and hyphens
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim();

      console.log('[AnthropicTitleService] Generated title:', title);

      // Validate title length and fallback if needed
      if (title.length > 60 || title.length < 2) {
        console.warn('[AnthropicTitleService] Generated title out of bounds, using fallback');
        return 'New Chat';
      }

      return title || 'New Chat';
    } catch (error) {
      console.error('[AnthropicTitleService] Error generating title:', error);
      if (error instanceof Error) {
        console.error('[AnthropicTitleService] Error details:', {
          name: error.name,
          message: error.message,
          stack: error.stack?.substring(0, 500),
        });
      }
      return 'New Chat';
    }
  }

  /**
   * Truncate text to a specific character limit while preserving word boundaries
   * @param text Text to truncate
   * @param maxLength Maximum character length
   * @returns Truncated text
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    const truncated = text.substring(0, maxLength);
    const lastSpaceIndex = truncated.lastIndexOf(' ');

    // If we can find a space to break on, use it; otherwise just cut off
    return lastSpaceIndex > maxLength * 0.8 ? truncated.substring(0, lastSpaceIndex) : truncated;
  }
}
