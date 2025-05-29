import { Context } from 'hono';
import { getAuth } from '@hono/oidc-auth';
import { streamSSE } from 'hono/streaming';
import { ConversationRepository } from '../../db/repositories/conversation';
import { MessageRepository } from '../../db/repositories/message';
import { ModelRepository } from '../../db/repositories/model';
import { OpenAIStreamingService } from '../../services/OpenAIStreamingService';
import { SseService, SseCompletionResult } from '../../services/SseService';
import { AskRequest, CreateConversationDTO, CreateMessageDTO } from '../../types';

// Constants for parent message ID handling (matching LibreChat)
const NO_PARENT = '00000000-0000-0000-0000-000000000000';

/**
 * Handler for POST /api/edit/openai
 * Processes message editing requests with OpenAI's GPT model using the shared streaming service
 * Returns streaming Server-Sent Events (SSE) responses compatible with LibreChat
 * Updates existing messages in the conversation thread
 */
export async function editOpenAI(c: Context<{ Bindings: CloudflareBindings }>) {
  try {
    // Get authenticated user
    const oidcUser = await getAuth(c);
    if (!oidcUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Check if OpenAI API key is available
    if (!c.env.OPENAI_API_KEY) {
      console.error('[editOpenAI] OPENAI_API_KEY not configured');
      return c.json({ error: 'OpenAI API key not configured' }, 500);
    }

    // Parse request body
    const requestData: AskRequest = await c.req.json();
    const {
      text,
      conversationId,
      parentMessageId, // This is actually the messageId of the message to edit!
      messageId, // This is the NEW message being created
      responseMessageId,
      overrideParentMessageId,
      endpoint,
      model,
      spec,
    } = requestData;

    // Initialize model repository to resolve spec to model
    const modelRepository = new ModelRepository(c.env.DB);

    // Resolve model from spec or fall back to model parameter
    let resolvedModel = model;
    let modelConfig = null;

    if (spec) {
      // Find the model configuration by spec
      modelConfig = await modelRepository.findBySpec(spec);
      if (modelConfig) {
        resolvedModel = modelConfig.modelId;
        console.log('[editOpenAI] Resolved spec to model:', {
          spec,
          resolvedModel,
          modelLabel: modelConfig.label,
        });
      } else {
        console.warn('[editOpenAI] Spec not found, falling back to model parameter:', {
          spec,
          fallbackModel: model,
        });
      }
    }

    if (!resolvedModel) {
      return c.json({ error: 'No model specified (spec or model parameter required)' }, 400);
    }

    console.log('[editOpenAI] Processing edit request:', {
      userId: oidcUser.sub,
      conversationId,
      messageToEdit: parentMessageId, // The message being edited
      newMessageId: messageId, // The new message being created
      responseMessageId,
      overrideParentMessageId,
      messageLength: text.length,
      spec,
      model: resolvedModel,
    });

    if (!text || !conversationId) {
      return c.json({ error: 'Text and conversationId are required' }, 400);
    }

    // Check if OpenAI API key is available
    if (!c.env.OPENAI_API_KEY) {
      console.error('[editOpenAI] OPENAI_API_KEY not configured');
      return c.json({ error: 'OpenAI API key not configured' }, 500);
    }

    // Initialize repositories
    const conversationRepository = new ConversationRepository(c.env.DB);
    const messageRepository = new MessageRepository(c.env.DB);

    // Get conversation (must exist for edit operations)
    const conversation = await conversationRepository.findByIdAndUser(conversationId, oidcUser.sub);
    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    // Determine the message to edit following LibreChat's confusing parameter naming
    const userMessageId = parentMessageId; // parentMessageId IS the message to edit!
    let messageIdToEdit = responseMessageId || overrideParentMessageId || userMessageId;

    console.log('[editOpenAI] Message identification:', {
      userMessageId,
      messageIdToEdit,
      parentMessageId,
      responseMessageId,
      overrideParentMessageId,
    });

    // Get the message to edit
    const messageToEdit = await messageRepository.findByIdAndUser(messageIdToEdit, oidcUser.sub);
    if (!messageToEdit) {
      return c.json({ error: 'Message to edit not found' }, 404);
    }

    // Create user message immediately (the edited version)
    const userMessage = {
      messageId,
      conversationId,
      parentMessageId: messageToEdit.parentMessageId,
      user: oidcUser.sub,
      sender: 'User',
      text,
      isCreatedByUser: true,
      model: resolvedModel,
      error: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save user message immediately (async)
    const userMessageData: CreateMessageDTO = {
      messageId: userMessage.messageId,
      conversationId,
      parentMessageId: userMessage.parentMessageId || undefined,
      userId: oidcUser.sub,
      sender: userMessage.sender,
      text: userMessage.text,
      isCreatedByUser: true,
      model: userMessage.model,
      error: false,
    };

    const userMessagePromise = messageRepository.create(userMessageData);

    // Generate response message ID
    const newResponseMessageId = responseMessageId || crypto.randomUUID();

    await userMessagePromise;

    // Build conversation history for context
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    try {
      console.log('[editOpenAI] Building conversation history for edit');

      // Get all messages for this conversation
      const allMessages = await messageRepository.findByConversationId(
        conversationId,
        oidcUser.sub,
      );

      // Build conversation context up to and including the edited user message
      const editedMessageIndex = allMessages.findIndex((msg) => msg.messageId === messageIdToEdit);
      const contextMessages = allMessages.slice(0, editedMessageIndex + 1);

      // Update the edited message in our context with the new text
      const updatedContextMessages = contextMessages.map((msg) =>
        msg.messageId === messageIdToEdit ? { ...msg, text } : msg,
      );

      // Convert to OpenAI format
      conversationHistory = updatedContextMessages
        .filter(
          (msg) => msg.sender === 'user' || msg.sender === 'assistant' || msg.sender === 'User',
        )
        .map((msg) => ({
          role: (msg.isCreatedByUser ? 'user' : 'assistant') as 'user' | 'assistant',
          content: msg.text || '',
        }));

      // Add the new user message to the conversation
      conversationHistory.push({
        role: 'user',
        content: text,
      });

      console.log('[editOpenAI] Conversation history built:', {
        historyLength: conversationHistory.length,
        messageTypes: conversationHistory.map((m) => m.role),
      });
    } catch (error) {
      console.error('[editOpenAI] Error building conversation history:', error);
      // Fallback to just the current message
      conversationHistory = [
        {
          role: 'user',
          content: text,
        },
      ];
    }

    // Use SSE Service for streaming
    return streamSSE(c, async (stream) => {
      const sseService = new SseService();
      const streamingService = new OpenAIStreamingService(c.env.OPENAI_API_KEY);

      await sseService.streamResponse(stream, {
        streamingService,
        streamingOptions: {
          messages: conversationHistory,
          model: resolvedModel,
          responseMessageId: newResponseMessageId,
          parentMessageId: messageId,
          conversationId,
          // Pass model configuration parameters
          systemMessage: modelConfig?.systemMessage,
          temperature: modelConfig?.temperature,
          topP: modelConfig?.topP,
          frequencyPenalty: modelConfig?.frequencyPenalty,
          presencePenalty: modelConfig?.presencePenalty,
          stopSequences: modelConfig?.stopSequences,
          maxTokens: modelConfig?.maxTokens || modelConfig?.maxOutput,
        },
        userMessage: {
          messageId: userMessage.messageId,
          parentMessageId: userMessage.parentMessageId,
          conversationId: conversationId!,
          sender: userMessage.sender,
          text: userMessage.text,
          isCreatedByUser: userMessage.isCreatedByUser,
        },
        responseMessage: {
          messageId: newResponseMessageId,
          model: resolvedModel,
          endpoint: endpoint || 'openAI',
        },
        conversation: {
          ...conversation,
          user: oidcUser.sub,
        },
        // Custom response builder for edit endpoint
        customFinalResponseBuilder: (result: SseCompletionResult) => {
          return {
            requestMessage: {
              messageId: userMessage.messageId,
              parentMessageId: userMessage.parentMessageId || NO_PARENT,
              conversationId: conversationId,
              sender: userMessage.sender,
              text: userMessage.text,
              isCreatedByUser: userMessage.isCreatedByUser,
              tokenCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            responseMessage: {
              messageId: result.responseMessage.messageId,
              conversationId: conversationId,
              parentMessageId: userMessage.messageId,
              isCreatedByUser: false,
              model: result.responseMessage.model,
              sender: result.responseMessage.model,
              promptTokens: 0,
              iconURL: result.responseMessage.endpoint,
              endpoint: result.responseMessage.endpoint,
              finish_reason: 'stop',
              text: result.responseText,
              tokenCount: result.tokenCount,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          };
        },
        // Handle completion events (persistence)
        onComplete: async (result: SseCompletionResult) => {
          // Save response message to database
          const responseMessageData: CreateMessageDTO = {
            messageId: result.responseMessage.messageId,
            conversationId: conversationId!,
            parentMessageId: messageId,
            userId: oidcUser.sub,
            sender: 'assistant',
            text: result.responseText,
            isCreatedByUser: false,
            model: result.responseMessage.model,
            error: false,
            tokenCount: result.tokenCount,
          };

          try {
            await messageRepository.create(responseMessageData);
            console.log('[editOpenAI] Response message saved successfully');
          } catch (error) {
            console.error('[editOpenAI] Error saving response message:', error);
          }
        },
      });
    });
  } catch (error) {
    console.error('[editOpenAI] Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}
