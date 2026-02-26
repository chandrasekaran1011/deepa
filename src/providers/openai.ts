// ─── OpenAI-compatible provider ───
// Works with: OpenAI API, Azure OpenAI, Ollama, LM Studio, vLLM, any OpenAI-compat endpoint

import type { LLMProvider, ChatOptions } from './base.js';
import type {
    Message, MessageContent, StreamChunk, ToolDefinition,
    TextContent, ToolCallContent, ToolResultContent,
} from '../types.js';

const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
}

/** Fetch with exponential backoff for 429 / 5xx responses. Supports abort signals. */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 10_000));
        }
        const res = await fetch(url, init);
        if (res.ok) return res;
        // Never retry auth or validation errors
        if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
            return res;
        }
        // Retry on rate-limit or server errors
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES - 1) {
            await res.text().catch(() => { }); // drain body to free connection
            continue;
        }
        return res;
    }
    return fetch(url, init);
}

export interface OpenAIProviderConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens?: number;
}

export class OpenAIProvider implements LLMProvider {
    readonly name = 'openai';
    private config: OpenAIProviderConfig;

    constructor(config: OpenAIProviderConfig) {
        this.config = {
            ...config,
            baseUrl: config.baseUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1',
        };
    }

    async *chat(
        messages: Message[],
        tools?: ToolDefinition[],
        options?: ChatOptions,
        signal?: AbortSignal,
    ): AsyncIterable<StreamChunk> {
        const body: Record<string, unknown> = {
            model: this.config.model,
            messages: this.convertMessages(messages),
            stream: true,
            max_completion_tokens: options?.maxTokens ?? this.config.maxTokens,
        };

        if (options?.temperature !== undefined) body.temperature = options.temperature;
        if (options?.topP !== undefined) body.top_p = options.topP;
        if (options?.stop) body.stop = options.stop;

        if (tools && tools.length > 0) {
            body.tools = tools.map((t) => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                },
            }));
        }

        let response: Response;
        try {
            response = await fetchWithRetry(`${this.config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
                },
                body: JSON.stringify(body),
                signal,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            yield { type: 'error', error: `Network error connecting to ${this.config.baseUrl}: ${msg}` };
            return;
        }

        if (!response.ok) {
            const errorText = await response.text();
            yield { type: 'error', error: `OpenAI API error ${response.status}: ${errorText}` };
            return;
        }

        if (!response.body) {
            yield { type: 'error', error: 'No response body' };
            return;
        }

        const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    if (!trimmed.startsWith('data: ')) continue;

                    try {
                        const data = JSON.parse(trimmed.slice(6));
                        const delta = data.choices?.[0]?.delta;
                        if (!delta) continue;

                        // Text content
                        if (delta.content) {
                            yield { type: 'text', text: delta.content };
                        }

                        // Tool calls
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const idx = tc.index ?? 0;
                                if (tc.id) {
                                    toolCalls.set(idx, {
                                        id: tc.id,
                                        name: tc.function?.name || '',
                                        arguments: tc.function?.arguments || '',
                                    });
                                } else {
                                    const existing = toolCalls.get(idx);
                                    if (existing) {
                                        if (tc.function?.name) existing.name += tc.function.name;
                                        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                                    }
                                }
                            }
                        }

                        // Check for finish
                        if (data.choices?.[0]?.finish_reason) {
                            // Emit accumulated tool calls
                            for (const [, tc] of toolCalls) {
                                yield {
                                    type: 'tool_call',
                                    id: tc.id,
                                    name: tc.name,
                                    arguments: tc.arguments,
                                };
                            }

                            yield {
                                type: 'done',
                                usage: data.usage
                                    ? {
                                        promptTokens: data.usage.prompt_tokens ?? 0,
                                        completionTokens: data.usage.completion_tokens ?? 0,
                                    }
                                    : undefined,
                            };
                        }
                    } catch {
                        // Skip malformed JSON lines
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    private convertMessages(messages: Message[]): unknown[] {
        return messages.map((msg) => {
            if (typeof msg.content === 'string') {
                return { role: msg.role, content: msg.content };
            }

            // Complex content
            const contents = msg.content as MessageContent[];

            if (msg.role === 'assistant') {
                const textParts = contents.filter((c): c is TextContent => c.type === 'text');
                const toolCallParts = contents.filter((c): c is ToolCallContent => c.type === 'tool_call');

                const result: Record<string, unknown> = {
                    role: 'assistant',
                    content: textParts.map((t) => t.text).join('') || null,
                };

                if (toolCallParts.length > 0) {
                    result.tool_calls = toolCallParts.map((tc) => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments),
                        },
                    }));
                }

                return result;
            }

            if (msg.role === 'tool') {
                const toolResults = contents.filter(
                    (c): c is ToolResultContent => c.type === 'tool_result',
                );
                // OpenAI expects one message per tool result
                return toolResults.map((tr) => ({
                    role: 'tool',
                    tool_call_id: tr.toolCallId,
                    content: tr.content,
                }));
            }

            // User / system — join text
            return {
                role: msg.role,
                content: contents
                    .filter((c): c is TextContent => c.type === 'text')
                    .map((t) => t.text)
                    .join('\n'),
            };
        }).flat();
    }
}
