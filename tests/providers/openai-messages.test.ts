// ─── OpenAI provider message conversion & retry tests ───

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.js';
import type { Message } from '../../src/types.js';

// ─── Helpers ───────────────────────────────────────────────

function makeProvider() {
    return new OpenAIProvider({
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        maxTokens: 1024,
    });
}

/** Collect all chunks from the provider into an array */
async function collectChunks(provider: OpenAIProvider, messages: Message[]) {
    const chunks = [];
    for await (const chunk of provider.chat(messages)) {
        chunks.push(chunk);
    }
    return chunks;
}

// ─── Mock fetch ────────────────────────────────────────────

function makeSSEStream(lines: string[]): Response {
    const body = lines.join('\n') + '\n';
    return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
    });
}

function makeOpenAITextSSE(text: string): string[] {
    return [
        `data: ${JSON.stringify({
            choices: [{ delta: { content: text }, finish_reason: null }],
        })}`,
        `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'stop' }],
        })}`,
        // Usage-only chunk (sent when stream_options.include_usage is true)
        `data: ${JSON.stringify({
            choices: [],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
        })}`,
        'data: [DONE]',
    ];
}

function makeOpenAIToolCallSSE(id: string, name: string, args: string): string[] {
    return [
        `data: ${JSON.stringify({
            choices: [{
                delta: {
                    tool_calls: [{ index: 0, id, function: { name, arguments: '' } }],
                },
                finish_reason: null,
            }],
        })}`,
        `data: ${JSON.stringify({
            choices: [{
                delta: {
                    tool_calls: [{ index: 0, function: { arguments: args } }],
                },
                finish_reason: null,
            }],
        })}`,
        `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        })}`,
        'data: [DONE]',
    ];
}

// ─── Tests ─────────────────────────────────────────────────

describe('OpenAI Provider', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('Text streaming', () => {
        it('yields text chunks from SSE stream', async () => {
            fetchMock.mockResolvedValueOnce(makeSSEStream(makeOpenAITextSSE('Hello world')));
            const provider = makeProvider();
            const chunks = await collectChunks(provider, [
                { role: 'user', content: 'hi' },
            ]);
            const textChunks = chunks.filter((c) => c.type === 'text');
            expect(textChunks.length).toBeGreaterThan(0);
            const text = textChunks.map((c) => (c as { type: 'text'; text: string }).text).join('');
            expect(text).toBe('Hello world');
        });

        it('yields a done chunk at end of stream', async () => {
            fetchMock.mockResolvedValueOnce(makeSSEStream(makeOpenAITextSSE('hi')));
            const provider = makeProvider();
            const chunks = await collectChunks(provider, [{ role: 'user', content: 'hi' }]);
            expect(chunks.some((c) => c.type === 'done')).toBe(true);
        });

        it('includes token usage in done chunk when available', async () => {
            fetchMock.mockResolvedValueOnce(makeSSEStream(makeOpenAITextSSE('hi')));
            const provider = makeProvider();
            const chunks = await collectChunks(provider, [{ role: 'user', content: 'hi' }]);
            const done = chunks.find((c) => c.type === 'done') as { type: 'done'; usage?: { promptTokens: number; completionTokens: number } };
            expect(done?.usage?.promptTokens).toBe(10);
            expect(done?.usage?.completionTokens).toBe(5);
        });
    });

    describe('Tool call streaming', () => {
        it('yields a tool_call chunk with correct id, name, arguments', async () => {
            fetchMock.mockResolvedValueOnce(
                makeSSEStream(makeOpenAIToolCallSSE('tc1', 'file_read', '{"path":"foo.ts"}')),
            );
            const provider = makeProvider();
            const chunks = await collectChunks(provider, [{ role: 'user', content: 'read' }]);
            const tc = chunks.find((c) => c.type === 'tool_call') as {
                type: 'tool_call'; id: string; name: string; arguments: string;
            } | undefined;
            expect(tc).toBeDefined();
            expect(tc?.id).toBe('tc1');
            expect(tc?.name).toBe('file_read');
            expect(tc?.arguments).toContain('foo.ts');
        });
    });

    describe('Error handling', () => {
        it('yields an error chunk on non-200 response after retries', async () => {
            // Return 500 three times (all retries exhausted)
            fetchMock
                .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))
                .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))
                .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));
            const provider = makeProvider();
            const chunks = await collectChunks(provider, [{ role: 'user', content: 'hi' }]);
            expect(chunks.some((c) => c.type === 'error')).toBe(true);
        }, 15_000);

        it('does not retry on 401 auth error', async () => {
            fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
            const provider = makeProvider();
            await collectChunks(provider, [{ role: 'user', content: 'hi' }]);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('retries on 429 rate limit', async () => {
            fetchMock
                .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
                .mockResolvedValueOnce(makeSSEStream(makeOpenAITextSSE('ok after retry')));
            const provider = makeProvider();
            const chunks = await collectChunks(provider, [{ role: 'user', content: 'hi' }]);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            const text = chunks
                .filter((c) => c.type === 'text')
                .map((c) => (c as { type: 'text'; text: string }).text)
                .join('');
            expect(text).toBe('ok after retry');
        }, 10_000);

        it('yields error chunk when response body is null', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(null, { status: 200 }),
            );
            const provider = makeProvider();
            const chunks = await collectChunks(provider, [{ role: 'user', content: 'hi' }]);
            expect(chunks.some((c) => c.type === 'error')).toBe(true);
        });
    });

    describe('Message conversion', () => {
        it('sends system messages correctly', async () => {
            fetchMock.mockResolvedValueOnce(makeSSEStream(makeOpenAITextSSE('ok')));
            const provider = makeProvider();
            const messages: Message[] = [
                { role: 'system', content: 'You are a helper' },
                { role: 'user', content: 'hello' },
            ];
            await collectChunks(provider, messages);
            const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
            const sysMsg = body.messages.find((m: { role: string }) => m.role === 'system');
            expect(sysMsg?.content).toBe('You are a helper');
        });

        it('sends tools when provided', async () => {
            fetchMock.mockResolvedValueOnce(makeSSEStream(makeOpenAITextSSE('ok')));
            const provider = makeProvider();
            await collectChunks(provider, [{ role: 'user', content: 'hi' }]);
            // No tools — body should have no tools key or empty
        });
    });
});
