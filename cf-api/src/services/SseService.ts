import type { SSEStreamingApi } from 'hono/streaming';
import {
  IStreamingService,
  StreamingServiceOptions,
  StreamingMessage,
  Conversation,
  Message,
} from '../types';

/**
 * Configuration options for the SSE service
 */
export interface SseServiceOptions {
  /** The AI streaming service to use (Anthropic, OpenAI, etc.) */
  streamingService: IStreamingService;
  /** Options to pass to the streaming service */
  streamingOptions: StreamingServiceOptions;
  /** User message that initiated the request */
  userMessage: {
    messageId: string;
    parentMessageId: string | null;
    conversationId: string;
    sender: string;
    text: string;
    isCreatedByUser: boolean;
  };
  /** Response message metadata */
  responseMessage: {
    messageId: string;
    model: string;
    endpoint: string;
  };
  /** Conversation context (if available) */
  conversation?: Conversation | null;
  /** Handler for completion events */
  onComplete?: (result: SseCompletionResult) => Promise<void>;
  /** Handler for errors */
  onError?: (error: Error) => Promise<void>;
  /** Custom final response builder (for edit endpoints) */
  customFinalResponseBuilder?: (result: SseCompletionResult) => {
    requestMessage?: Message;
    responseMessage?: any;
  };
}

/**
 * Result data passed to completion handlers
 */
export interface SseCompletionResult {
  responseText: string;
  tokenCount: number;
  userMessage: SseServiceOptions['userMessage'];
  responseMessage: SseServiceOptions['responseMessage'];
  conversation?: Conversation | null;
}

/**
 * SSE Service handles the Server-Sent Events protocol for AI streaming responses
 * Provides a clean separation between API endpoints and streaming protocol details
 * Orchestrates AI streaming services while providing hooks for completion events
 */
export class SseService {
  /**
   * Stream an AI response using SSE protocol with LibreChat compatibility
   * @param stream Hono SSE stream instance for sending real-time updates
   * @param options Configuration including streaming service, messages, and handlers
   */
  async streamResponse(stream: SSEStreamingApi, options: SseServiceOptions): Promise<void> {
    const {
      streamingService,
      streamingOptions,
      userMessage,
      responseMessage,
      conversation,
      onComplete,
      onError,
    } = options;

    try {
      // Send initial "created" event with user message (matches LibreChat format)
      const initialCreatedEvent = {
        message: {
          messageId: userMessage.messageId,
          parentMessageId: userMessage.parentMessageId || '00000000-0000-0000-0000-000000000000',
          conversationId: userMessage.conversationId,
          sender: userMessage.sender,
          text: userMessage.text,
          isCreatedByUser: userMessage.isCreatedByUser,
        },
        created: true,
      };

      await stream.writeSSE({
        data: JSON.stringify(initialCreatedEvent),
        event: 'message',
      });

      console.log('[SseService] Starting AI streaming for:', {
        conversationId: userMessage.conversationId,
        responseMessageId: responseMessage.messageId,
        model: responseMessage.model,
      });

      // Stream response from AI service
      const { responseText, tokenCount } = await streamingService.streamResponse(
        stream,
        streamingOptions,
      );

      console.log('[SseService] AI streaming completed:', {
        responseLength: responseText.length,
        tokenCount,
      });

      // Prepare completion result
      const completionResult: SseCompletionResult = {
        responseText,
        tokenCount,
        userMessage,
        responseMessage,
        conversation,
      };

      // Call completion handler if provided
      if (onComplete) {
        await onComplete(completionResult);
      }

      // Create final response message for the SSE final event
      const finalResponseMessage = {
        messageId: responseMessage.messageId,
        conversationId: userMessage.conversationId,
        parentMessageId: userMessage.messageId,
        isCreatedByUser: false,
        model: responseMessage.model,
        sender: responseMessage.model,
        promptTokens: 0, // TODO: Calculate actual prompt tokens
        iconURL: responseMessage.endpoint,
        endpoint: responseMessage.endpoint,
        finish_reason: 'stop',
        text: responseText,
        tokenCount,
      };

      // Build custom response if provided, otherwise use default
      const customResponse = options.customFinalResponseBuilder?.(completionResult);

      // Build final SSE response (matches LibreChat format)
      const finalResponse: StreamingMessage = {
        final: true,
        conversation: conversation || this.buildDefaultConversation(userMessage, responseMessage),
        title: conversation?.title || 'New Chat',
        requestMessage: customResponse?.requestMessage || {
          messageId: userMessage.messageId,
          parentMessageId: userMessage.parentMessageId || '00000000-0000-0000-0000-000000000000',
          conversationId: userMessage.conversationId,
          sender: userMessage.sender,
          text: userMessage.text,
          isCreatedByUser: userMessage.isCreatedByUser,
          tokenCount: 0, // TODO: Calculate actual token count for user message
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        responseMessage: customResponse?.responseMessage || {
          ...finalResponseMessage,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      await stream.writeSSE({
        data: JSON.stringify(finalResponse),
        event: 'message',
      });

      console.log('[SseService] SSE streaming completed successfully');
    } catch (error) {
      console.error('[SseService] Error in streaming:', error);

      // Call error handler if provided
      if (onError) {
        await onError(error as Error);
      }

      // Send error event via SSE
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';

      await stream.writeSSE({
        data: JSON.stringify({
          error: true,
          text: errorMessage,
          messageId: responseMessage.messageId,
          conversationId: userMessage.conversationId,
        } as StreamingMessage),
        event: 'error',
      });

      throw error;
    }
  }

  /**
   * Build a default conversation object for new conversations
   * @param userMessage User message data
   * @param responseMessage Response message data
   * @returns Default conversation object matching LibreChat format
   */
  private buildDefaultConversation(
    userMessage: SseServiceOptions['userMessage'],
    responseMessage: SseServiceOptions['responseMessage'],
  ): Conversation {
    return {
      conversationId: userMessage.conversationId,
      user: '', // Will be set by caller
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      endpoint: responseMessage.endpoint,
      model: responseMessage.model,
      modelLabel:
        responseMessage.model === 'claude-sonnet-4-20250514'
          ? 'Claude 3.5 Sonnet'
          : responseMessage.model,
      isArchived: false,
      messages: [userMessage.messageId, responseMessage.messageId],
      iconURL: responseMessage.endpoint,
      spec: responseMessage.endpoint,
      temperature: 0.2,
      top_p: 0.85,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
      resendFiles: true,
      tags: [],
    };
  }
}
