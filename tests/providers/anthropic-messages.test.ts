// ─── Anthropic provider message conversion & retry tests ───

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../../src/providers/anthropic.js';
import type { Message } from '../../src/types.js';

// ─── Helpers ───────────────────────────────────────────────

function makeProvider() {
    return new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-sonnet-4-6',
        maxTokens: 1024,
    });
}

async function collectChunks(provider: AnthropicProvider, messages: Message[]) {
    const chunks = [];
    for await (const chunk of provider.chat(messages)) {
        chunks.push(chunk);
    }
    return chunks;
}

// ─── SSE helpers ───────────────────────────────────────────

function makeAnthropicSSE(events: object[]): Response {
    const lines = events.map((e) => `data: ${JSON.stringify(e)}`).join('\n');
    return new Response(lines + '\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
    });
}

function makeTextEvents(text: string): object[] {
    return [
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop', usage: { input_tokens: 12, output_tokens: 8 } },
    ];
}

function makeToolUseEvents(id: string, name: string, args: string): object[] {
    return [
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
    ];
}

// ─── Tests ─────────────────────────────────────────────────

describe('Anthropic Provider', () => {
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
            fetchMock.mockResolvedValueOnce(makeAnthropicSSE(makeTextEvents('Hello Claude')));
            const chunks = await collectChunks(makeProvider(), [{ role: 'user', content: 'hi' }]);
            const text = chunks
                .filter((c) => c.type === 'text')
                .map((c) => (c as { type: 'text'; text: string }).text)
                .join('');
            expect(text).toBe('Hello Claude');
        });

        it('yields a done chunk', async () => {
            fetchMock.mockResolvedValueOnce(makeAnthropicSSE(makeTextEvents('hi')));
            const chunks = await collectChunks(makeProvider(), [{ role: 'user', content: 'hi' }]);
            expect(chunks.some((c) => c.type === 'done')).toBe(true);
        });
    });

    describe('Tool call streaming', () => {
        it('yields tool_call chunk with id, name, arguments', async () => {
            fetchMock.mockResolvedValueOnce(
                makeAnthropicSSE(makeToolUseEvents('tu1', 'file_read', '{"path":"app.ts"}')),
            );
            const chunks = await collectChunks(makeProvider(), [{ role: 'user', content: 'read' }]);
            const tc = chunks.find((c) => c.type === 'tool_call') as {
                type: 'tool_call'; id: string; name: string; arguments: string;
            } | undefined;
            expect(tc).toBeDefined();
            expect(tc?.id).toBe('tu1');
            expect(tc?.name).toBe('file_read');
            expect(tc?.arguments).toContain('app.ts');
        });
    });

    describe('API version header', () => {
        it('sends the 2024-10-22 API version header', async () => {
            fetchMock.mockResolvedValueOnce(makeAnthropicSSE(makeTextEvents('ok')));
            await collectChunks(makeProvider(), [{ role: 'user', content: 'hi' }]);
            const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
            expect(headers['anthropic-version']).toBe('2024-10-22');
        });
    });

    describe('Error handling and retry', () => {
        it('yields error chunk on non-200 response after retries', async () => {
            fetchMock
                .mockResolvedValueOnce(new Response('Error', { status: 500 }))
                .mockResolvedValueOnce(new Response('Error', { status: 500 }))
                .mockResolvedValueOnce(new Response('Error', { status: 500 }));
            const chunks = await collectChunks(makeProvider(), [{ role: 'user', content: 'hi' }]);
            expect(chunks.some((c) => c.type === 'error')).toBe(true);
        }, 15_000);

        it('does not retry 401 auth error', async () => {
            fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
            await collectChunks(makeProvider(), [{ role: 'user', content: 'hi' }]);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('retries on 529 overloaded error', async () => {
            fetchMock
                .mockResolvedValueOnce(new Response('Overloaded', { status: 529 }))
                .mockResolvedValueOnce(makeAnthropicSSE(makeTextEvents('ok')));
            const chunks = await collectChunks(makeProvider(), [{ role: 'user', content: 'hi' }]);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            const text = chunks
                .filter((c) => c.type === 'text')
                .map((c) => (c as { type: 'text'; text: string }).text)
                .join('');
            expect(text).toBe('ok');
        }, 10_000);
    });

    describe('System prompt extraction', () => {
        it('extracts system message and sends it as top-level system field', async () => {
            fetchMock.mockResolvedValueOnce(makeAnthropicSSE(makeTextEvents('ok')));
            const messages: Message[] = [
                { role: 'system', content: 'Be helpful' },
                { role: 'user', content: 'hi' },
            ];
            await collectChunks(makeProvider(), messages);
            const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
            expect(body.system).toBe('Be helpful');
            expect(body.messages.every((m: { role: string }) => m.role !== 'system')).toBe(true);
        });
    });
});
