// ─── LLM Provider interface ───

import type { Message, StreamChunk, ToolDefinition } from '../types.js';

export interface ChatOptions {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stop?: string[];
}

export interface LLMProvider {
    readonly name: string;
    chat(
        messages: Message[],
        tools?: ToolDefinition[],
        options?: ChatOptions,
    ): AsyncIterable<StreamChunk>;
}
