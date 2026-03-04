// ─── OpenAI-compatible provider ───
// Works with: OpenAI API, Azure OpenAI, Ollama, LM Studio, vLLM, any OpenAI-compat endpoint

import type { LLMProvider, ChatOptions } from './base.js';
import type {
    Message, MessageContent, StreamChunk, ToolDefinition,
    TextContent, ImageContent, ToolCallContent, ToolResultContent,
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

/**
 * Filters `<think>...</think>` blocks from streamed text.
 * Local models (Qwen, DeepSeek, etc.) emit reasoning inside these tags.
 *
 * Handles multiple patterns seen in the wild:
 *   1. `<think>...content...</think>` — standard wrapped thinking
 *   2. Content starts directly with thinking (LM Studio strips `<think>`),
 *      only `</think>` appears in the stream
 *   3. Multiple `</think>` tags scattered through the response
 */
class ThinkTagFilter {
    private inside = false;
    private buf = '';
    private seenAnyOutput = false; // true once we've emitted non-empty text

    /** Feed a text chunk, returns the text to emit (may be empty). */
    feed(text: string): string {
        this.buf += text;
        let out = '';

        while (this.buf.length > 0) {
            if (this.inside) {
                // Look for closing tag
                const closeIdx = this.buf.indexOf('</think>');
                if (closeIdx !== -1) {
                    this.inside = false;
                    this.buf = this.buf.slice(closeIdx + 8);
                } else {
                    // Might be a partial `</think>` at end — keep last 8 chars
                    if (this.buf.length > 8) {
                        this.buf = this.buf.slice(-8);
                    }
                    break;
                }
            } else {
                // Look for opening tag
                const openIdx = this.buf.indexOf('<think>');
                if (openIdx !== -1) {
                    out += this.buf.slice(0, openIdx);
                    this.inside = true;
                    this.buf = this.buf.slice(openIdx + 7);
                    continue;
                }

                // Handle bare `</think>` without matching `<think>`.
                // LM Studio often strips the opening tag; the model starts
                // inside a think block and only `</think>` appears in content.
                const bareClose = this.buf.indexOf('</think>');
                if (bareClose !== -1) {
                    // Everything before the bare close tag was thinking — discard
                    // unless we've already emitted real output.
                    if (this.seenAnyOutput) {
                        out += this.buf.slice(0, bareClose);
                    }
                    // Skip the tag itself
                    this.buf = this.buf.slice(bareClose + 8);
                    continue;
                }

                // No tags found — emit safe portion (hold back potential partial tags)
                const maxPartial = 8; // max length of `</think>`
                const safe = this.buf.length > maxPartial ? this.buf.length - maxPartial : 0;
                out += this.buf.slice(0, safe);
                this.buf = this.buf.slice(safe);
                break;
            }
        }

        if (out.trim()) this.seenAnyOutput = true;
        return out;
    }

    /** Flush any remaining buffered text (call at stream end). */
    flush(): string {
        // Strip any remaining `</think>` in the buffer
        let remaining = this.inside ? '' : this.buf;
        remaining = remaining.replace(/<\/?think>/g, '');
        this.buf = '';
        this.inside = false;
        return remaining;
    }
}

/**
 * Detects when a local model is stuck in a repetition loop.
 * Watches for the same text block repeating and signals to stop.
 */
class RepetitionDetector {
    private window = '';
    private readonly windowSize = 600;  // chars to keep for comparison
    private readonly minRepeat = 80;    // min repeated block size to trigger

    /** Feed text, returns true if repetition loop detected. */
    feed(text: string): boolean {
        this.window += text;
        if (this.window.length > this.windowSize * 2) {
            this.window = this.window.slice(-this.windowSize);
        }

        if (this.window.length < this.minRepeat * 2) return false;

        // Check if the last N chars repeat earlier in the window
        const tail = this.window.slice(-this.minRepeat);
        const earlier = this.window.slice(0, -this.minRepeat);
        return earlier.includes(tail);
    }
}

export interface OpenAIProviderConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens?: number;
    isLocal?: boolean;  // auto-detected: true for ollama/lmstudio/custom
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
        const maxTokens = options?.maxTokens ?? this.config.maxTokens;
        const body: Record<string, unknown> = {
            model: this.config.model,
            messages: this.convertMessages(messages),
            stream: true,
        };

        if (this.config.isLocal) {
            // Ollama / LM Studio: use standard max_tokens, no stream_options
            if (maxTokens) body.max_tokens = maxTokens;
        } else {
            // OpenAI / Azure OpenAI / any cloud: use max_completion_tokens only.
            // Newer models (o1, o3, gpt-4.1) reject `max_tokens`.
            // This covers openai.com, Azure deployments, and any OpenAI-compatible cloud.
            body.stream_options = { include_usage: true };
            if (maxTokens) body.max_completion_tokens = maxTokens;
        }

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
                    ...(this.config.apiKey ? {
                        Authorization: `Bearer ${this.config.apiKey}`,
                        'api-key': this.config.apiKey
                    } : {}),
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
        let doneEmitted = false;
        let toolCallsEmitted = false;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Local model helpers: strip <think> tags and detect repetition loops
        const thinkFilter = this.config.isLocal ? new ThinkTagFilter() : null;
        const repDetector = this.config.isLocal ? new RepetitionDetector() : null;

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

                        // Usage-only chunk (sent after finish when stream_options.include_usage is true)
                        if (!delta && data.usage) {
                            doneEmitted = true;
                            yield {
                                type: 'done',
                                usage: {
                                    promptTokens: data.usage.prompt_tokens ?? 0,
                                    completionTokens: data.usage.completion_tokens ?? 0,
                                },
                            };
                            continue;
                        }

                        if (!delta) continue;

                        // Text content
                        if (delta.content) {
                            let text = delta.content;

                            // Strip <think>...</think> blocks for local models
                            if (thinkFilter) {
                                text = thinkFilter.feed(text);
                            }

                            // Detect repetition loops in local models
                            if (repDetector && repDetector.feed(delta.content)) {
                                // Abort the reader — model is stuck
                                reader.cancel().catch(() => { });
                                yield { type: 'text', text: '\n\n[Stopped: repetitive output detected]' };
                                yield { type: 'done' };
                                return;
                            }

                            if (text) {
                                yield { type: 'text', text };
                            }
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
                            toolCallsEmitted = true;
                            for (const [, tc] of toolCalls) {
                                yield {
                                    type: 'tool_call',
                                    id: tc.id,
                                    name: tc.name,
                                    arguments: tc.arguments,
                                };
                            }
                        }
                    } catch {
                        // Skip malformed JSON lines
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        // Flush any remaining text from the think tag filter
        if (thinkFilter) {
            const remaining = thinkFilter.flush();
            if (remaining) {
                yield { type: 'text', text: remaining };
            }
        }

        // Fallback for local models that don't send usage chunks:
        // ensure tool calls and done are always emitted
        if (!doneEmitted) {
            if (!toolCallsEmitted) {
                for (const [, tc] of toolCalls) {
                    yield { type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments };
                }
            }
            yield { type: 'done' };
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
                    // OpenAI accepts null here, but LM Studio's Jinja templates
                    // crash on null with "Cannot apply filter string to NullValue".
                    // Use empty string for local models.
                    content: textParts.map((t) => t.text).join('') || (this.config.isLocal ? '' : null),
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
                    content: tr.content || '',
                }));
            }

            // User / system — may include text and images
            const hasImages = contents.some((c) => c.type === 'image');
            if (hasImages) {
                const parts: unknown[] = [];
                for (const c of contents) {
                    if (c.type === 'text') {
                        parts.push({ type: 'text', text: (c as TextContent).text });
                    } else if (c.type === 'image') {
                        const img = c as ImageContent;
                        parts.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${img.source.mediaType};base64,${img.source.data}`,
                            },
                        });
                    }
                }
                return { role: msg.role, content: parts };
            }
            // Text-only fallback
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
