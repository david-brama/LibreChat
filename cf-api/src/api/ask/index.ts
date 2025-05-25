import { Hono } from 'hono';
import { askAnthropic } from './anthropic';

/**
 * Ask routes for /api/ask
 * Handles LLM chat completion requests
 */
const ask = new Hono<{ Bindings: CloudflareBindings }>();

// POST /api/ask/anthropic - Send a message to Anthropic's Claude
ask.post('/anthropic', askAnthropic);

export default ask;
