// ─── LLM Provider interface ───

import type { Message, StreamChunk, ToolDefinition } from '../types.js';

export interface ChatOptions {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stop?: string[];
    reasoningEffort?: 'low' | 'medium' | 'high'; // OpenAI o-series reasoning_effort
    thinkingBudget?: number; // Anthropic extended thinking budget_tokens (min 1024)
}

export interface LLMProvider {
    readonly name: string;
    chat(
        messages: Message[],
        tools?: ToolDefinition[],
        options?: ChatOptions,
        signal?: AbortSignal,
    ): AsyncIterable<StreamChunk>;
}
