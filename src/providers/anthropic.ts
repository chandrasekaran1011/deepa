// ─── Anthropic Claude provider ───

import type { LLMProvider, ChatOptions } from './base.js';
import type {
    Message, MessageContent, StreamChunk, ToolDefinition,
    TextContent, ToolCallContent, ToolResultContent,
} from '../types.js';

const ANTHROPIC_API_VERSION = '2024-10-22';
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
}

/** Fetch with exponential backoff for 429 / 5xx responses. */
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
    // Should not reach here
    return fetch(url, init);
}

export interface AnthropicProviderConfig {
    apiKey: string;
    baseUrl?: string;
    model: string;
    maxTokens: number;
}

export class AnthropicProvider implements LLMProvider {
    readonly name = 'anthropic';
    private config: AnthropicProviderConfig;

    constructor(config: AnthropicProviderConfig) {
        this.config = {
            ...config,
            baseUrl: config.baseUrl?.replace(/\/$/, '') || 'https://api.anthropic.com',
        };
    }

    async *chat(
        messages: Message[],
        tools?: ToolDefinition[],
        options?: ChatOptions,
    ): AsyncIterable<StreamChunk> {
        // Extract system prompt
        let systemPrompt = '';
        const conversationMessages = messages.filter((m) => {
            if (m.role === 'system') {
                systemPrompt += typeof m.content === 'string' ? m.content : '';
                return false;
            }
            return true;
        });

        const body: Record<string, unknown> = {
            model: this.config.model,
            messages: this.convertMessages(conversationMessages),
            max_tokens: options?.maxTokens ?? this.config.maxTokens,
            stream: true,
        };

        if (systemPrompt) body.system = systemPrompt;
        if (options?.temperature !== undefined) body.temperature = options.temperature;
        if (options?.topP !== undefined) body.top_p = options.topP;
        if (options?.stop) body.stop_sequences = options.stop;

        if (tools && tools.length > 0) {
            body.tools = tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
            }));
        }

        let response: Response;
        try {
            response = await fetchWithRetry(`${this.config.baseUrl}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.config.apiKey,
                    'anthropic-version': ANTHROPIC_API_VERSION,
                },
                body: JSON.stringify(body),
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            yield { type: 'error', error: `Network error connecting to Anthropic: ${msg}` };
            return;
        }

        if (!response.ok) {
            const errorText = await response.text();
            yield { type: 'error', error: `Anthropic API error ${response.status}: ${errorText}` };
            return;
        }

        if (!response.body) {
            yield { type: 'error', error: 'No response body' };
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentToolId = '';
        let currentToolName = '';
        let currentToolArgs = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data: ')) continue;

                    try {
                        const data = JSON.parse(trimmed.slice(6));

                        switch (data.type) {
                            case 'content_block_start': {
                                const block = data.content_block;
                                if (block?.type === 'tool_use') {
                                    currentToolId = block.id;
                                    currentToolName = block.name;
                                    currentToolArgs = '';
                                }
                                break;
                            }

                            case 'content_block_delta': {
                                const delta = data.delta;
                                if (delta?.type === 'text_delta') {
                                    yield { type: 'text', text: delta.text };
                                } else if (delta?.type === 'input_json_delta') {
                                    currentToolArgs += delta.partial_json;
                                }
                                break;
                            }

                            case 'content_block_stop': {
                                if (currentToolId) {
                                    yield {
                                        type: 'tool_call',
                                        id: currentToolId,
                                        name: currentToolName,
                                        arguments: currentToolArgs,
                                    };
                                    currentToolId = '';
                                    currentToolName = '';
                                    currentToolArgs = '';
                                }
                                break;
                            }

                            case 'message_delta': {
                                // stop_reason available
                                break;
                            }

                            case 'message_stop': {
                                yield {
                                    type: 'done',
                                    usage: data.usage
                                        ? {
                                            promptTokens: data.usage?.input_tokens ?? 0,
                                            completionTokens: data.usage?.output_tokens ?? 0,
                                        }
                                        : undefined,
                                };
                                break;
                            }
                        }
                    } catch {
                        // Skip malformed JSON
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    private convertMessages(messages: Message[]): unknown[] {
        const result: unknown[] = [];

        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                result.push({ role: msg.role === 'tool' ? 'user' : msg.role, content: msg.content });
                continue;
            }

            const contents = msg.content as MessageContent[];

            if (msg.role === 'assistant') {
                const blocks: unknown[] = [];

                for (const c of contents) {
                    if (c.type === 'text') {
                        blocks.push({ type: 'text', text: (c as TextContent).text });
                    } else if (c.type === 'tool_call') {
                        const tc = c as ToolCallContent;
                        blocks.push({
                            type: 'tool_use',
                            id: tc.id,
                            name: tc.name,
                            input: tc.arguments,
                        });
                    }
                }

                result.push({ role: 'assistant', content: blocks });
                continue;
            }

            if (msg.role === 'tool') {
                const blocks: unknown[] = [];
                for (const c of contents) {
                    if (c.type === 'tool_result') {
                        const tr = c as ToolResultContent;
                        blocks.push({
                            type: 'tool_result',
                            tool_use_id: tr.toolCallId,
                            content: tr.content,
                            is_error: tr.isError ?? false,
                        });
                    }
                }
                result.push({ role: 'user', content: blocks });
                continue;
            }

            // User message
            result.push({
                role: 'user',
                content: contents
                    .filter((c): c is TextContent => c.type === 'text')
                    .map((t) => ({ type: 'text', text: t.text })),
            });
        }

        return result;
    }
}
