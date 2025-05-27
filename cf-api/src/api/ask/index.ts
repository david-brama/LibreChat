import { Hono } from 'hono';
import { askAnthropic } from './anthropic';
import { askOpenAI } from './openai';

/**
 * Ask routes for /api/ask
 * Handles LLM chat completion requests
 */
const ask = new Hono<{ Bindings: CloudflareBindings }>();

// POST /api/ask/anthropic - Send a message to Anthropic's Claude
ask.post('/anthropic', askAnthropic);

// POST /api/ask/openAI - Send a message to OpenAI's GPT models
ask.post('/openAI', askOpenAI);

export default ask;
