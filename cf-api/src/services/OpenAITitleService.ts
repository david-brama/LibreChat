import OpenAI from 'openai';

/**
 * Service for generating conversation titles using OpenAI GPT models
 * Uses a lightweight model for cost-effective and fast title generation
 * Implements caching to avoid redundant API calls for the same conversation
 */
export class OpenAITitleService {
  private openai: OpenAI;
  private readonly TITLE_MODEL = 'gpt-4.1-nano'; // Fast, cost-effective model for title generation

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Generate a conversation title based on the first user message and AI response
   * Uses GPT-4.1-nano for fast and cost-effective title generation
   * @param userText The initial user message that started the conversation
   * @param responseText The AI's response to the user message
   * @returns Promise<string> A concise, descriptive title for the conversation
   */
  async generateTitle(userText: string, responseText: string): Promise<string> {
    console.log('[OpenAITitleService] Generating title for conversation');

    try {
      const titlePrompt = this.buildTitlePrompt(userText, responseText);

      const completion = await this.openai.chat.completions.create({
        model: this.TITLE_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant that creates concise, descriptive titles for conversations. Generate a title that captures the main topic or intent of the conversation in 4-6 words maximum. Do not use quotes or special formatting.',
          },
          {
            role: 'user',
            content: titlePrompt,
          },
        ],
        max_tokens: 50,
        temperature: 0.3, // Lower temperature for more consistent, focused titles
      });

      const title = completion.choices[0]?.message?.content?.trim();

      if (!title) {
        console.warn('[OpenAITitleService] No title generated, using fallback');
        return this.generateFallbackTitle(userText);
      }

      // Clean and validate the generated title
      const cleanTitle = this.cleanTitle(title);
      console.log('[OpenAITitleService] Generated title:', cleanTitle);

      return cleanTitle;
    } catch (error) {
      console.error('[OpenAITitleService] Error generating title:', error);

      // Fallback to a simple title based on user input
      return this.generateFallbackTitle(userText);
    }
  }

  /**
   * Build the prompt for title generation based on the conversation context
   * @param userText The user's initial message
   * @param responseText The AI's response
   * @returns A formatted prompt for title generation
   */
  private buildTitlePrompt(userText: string, responseText: string): string {
    // Truncate messages if they're too long to stay within token limits
    const maxLength = 500;
    const truncatedUser =
      userText.length > maxLength ? userText.substring(0, maxLength) + '...' : userText;
    const truncatedResponse =
      responseText.length > maxLength ? responseText.substring(0, maxLength) + '...' : responseText;

    return `Based on this conversation, generate a concise title (4-6 words):

User: ${truncatedUser}

AI: ${truncatedResponse}`;
  }

  /**
   * Clean and format the generated title
   * @param title Raw title from the AI
   * @returns Cleaned and formatted title
   */
  private cleanTitle(title: string): string {
    // Remove quotes and extra whitespace
    let cleaned = title.trim().replace(/^["']|["']$/g, '');

    // Limit length to prevent overly long titles
    const maxLength = 50;
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength).trim();
    }

    // Ensure it doesn't end with incomplete words or punctuation
    if (cleaned.endsWith(',') || cleaned.endsWith(':')) {
      cleaned = cleaned.slice(0, -1).trim();
    }

    return cleaned || 'New Chat'; // Fallback if cleaning results in empty string
  }

  /**
   * Generate a fallback title when AI title generation fails
   * @param userText The user's message to base the title on
   * @returns A simple fallback title
   */
  private generateFallbackTitle(userText: string): string {
    // Extract the first few words of the user message
    const words = userText.trim().split(/\s+/);

    if (words.length <= 4) {
      return userText.trim();
    }

    // Take first 4 words and add ellipsis if needed
    const shortTitle = words.slice(0, 4).join(' ');
    return shortTitle.length < userText.length ? shortTitle + '...' : shortTitle;
  }
}
