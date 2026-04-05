// ─── Compression system tests ───

import { describe, it, expect } from 'vitest';
import { compressConversationHistory } from '../../src/context/compression.js';
import type { LLMProvider } from '../../src/providers/base.js';
import type { Message, StreamChunk } from '../../src/types.js';

// Mock provider that returns a fixed summary
function mockProvider(summary: string): LLMProvider {
    return {
        name: 'mock-compressor',
        async *chat(): AsyncIterable<StreamChunk> {
            yield { type: 'text', text: summary };
            yield { type: 'done' };
        },
    };
}

// Provider that tracks how many times chat() is called
function countingProvider(summary: string): { provider: LLMProvider; getCount: () => number } {
    let count = 0;
    return {
        provider: {
            name: 'counting-mock',
            async *chat(): AsyncIterable<StreamChunk> {
                count++;
                yield { type: 'text', text: summary };
                yield { type: 'done' };
            },
        },
        getCount: () => count,
    };
}

function makeMessages(n: number): Message[] {
    const msgs: Message[] = [{ role: 'system', content: 'You are helpful.' }];
    for (let i = 0; i < n; i++) {
        msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` });
    }
    return msgs;
}

describe('Compression System', () => {
    describe('threshold behavior', () => {
        it('does not compress when below threshold', async () => {
            const msgs = makeMessages(10);
            const provider = mockProvider('should not be called');
            const result = await compressConversationHistory(msgs, provider, 20);
            expect(result).toBe(msgs); // exact same reference
        });

        it('does not compress when exactly at threshold', async () => {
            const msgs = makeMessages(19); // 19 + 1 system = 20
            const result = await compressConversationHistory(msgs, mockProvider('x'), 20);
            expect(result).toBe(msgs);
        });

        it('compresses when above threshold', async () => {
            const msgs = makeMessages(25); // 25 + 1 system = 26
            const result = await compressConversationHistory(msgs, mockProvider('compressed summary'), 20);
            expect(result.length).toBeLessThan(msgs.length);
        });

        it('threshold of 0 forces compression on any non-trivial history', async () => {
            const msgs = makeMessages(10);
            const result = await compressConversationHistory(msgs, mockProvider('forced'), 0);
            expect(result.length).toBeLessThan(msgs.length);
        });
    });

    describe('message structure after compression', () => {
        it('preserves system prompt as first message', async () => {
            const msgs = makeMessages(25);
            const result = await compressConversationHistory(msgs, mockProvider('summary'), 20);
            expect(result[0].role).toBe('system');
            expect(result[0].content).toBe('You are helpful.');
        });

        it('second message is user role with summary', async () => {
            const msgs = makeMessages(25);
            const result = await compressConversationHistory(msgs, mockProvider('my summary'), 20);
            expect(result[1].role).toBe('user');
            expect(result[1].content).toContain('History Compacted');
            expect(result[1].content).toContain('my summary');
        });

        it('keeps recent messages intact', async () => {
            const msgs = makeMessages(25);
            const lastMsg = msgs[msgs.length - 1];
            const result = await compressConversationHistory(msgs, mockProvider('summary'), 20);
            expect(result[result.length - 1].content).toBe(lastMsg.content);
        });

        it('does not produce user→user sequence', async () => {
            // Craft messages where recent starts with user
            const msgs: Message[] = [
                { role: 'system', content: 'sys' },
                ...Array.from({ length: 20 }, (_, i) => ({
                    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
                    content: `msg ${i}`,
                })),
                // Recent messages start with user
                { role: 'user', content: 'recent user' },
                { role: 'assistant', content: 'recent assistant' },
                { role: 'user', content: 'latest user' },
                { role: 'assistant', content: 'latest assistant' },
                { role: 'user', content: 'final user' },
                { role: 'assistant', content: 'final assistant' },
            ];
            const result = await compressConversationHistory(msgs, mockProvider('summary'), 20);
            // After the summary (user), should not have another user immediately
            for (let i = 1; i < result.length - 1; i++) {
                if (result[i].role === 'user' && result[i + 1]?.role === 'user') {
                    // This should not happen
                    expect(false).toBe(true);
                }
            }
        });

        it('does not produce user→tool sequence', async () => {
            const msgs: Message[] = [
                { role: 'system', content: 'sys' },
                ...Array.from({ length: 20 }, (_, i) => ({
                    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
                    content: `msg ${i}`,
                })),
                // Recent starts with a tool message (orphaned)
                { role: 'tool', content: [{ type: 'tool_result', toolCallId: 'tc1', content: 'result' }] },
                { role: 'assistant', content: 'after tool' },
                { role: 'user', content: 'user after' },
                { role: 'assistant', content: 'assistant after' },
                { role: 'user', content: 'final' },
                { role: 'assistant', content: 'done' },
            ];
            const result = await compressConversationHistory(msgs, mockProvider('summary'), 20);
            // After the summary (user role), should not be tool
            const summaryIdx = result.findIndex(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('History Compacted'));
            if (summaryIdx >= 0 && summaryIdx + 1 < result.length) {
                expect(result[summaryIdx + 1].role).not.toBe('tool');
            }
        });
    });

    describe('error handling', () => {
        it('falls back to naive slice when API call fails', async () => {
            const failProvider: LLMProvider = {
                name: 'fail-mock',
                async *chat(): AsyncIterable<StreamChunk> {
                    throw new Error('API quota exceeded');
                },
            };
            const msgs = makeMessages(25);
            const result = await compressConversationHistory(msgs, failProvider, 20);
            // Should return system + recent messages, without crash
            expect(result.length).toBeLessThan(msgs.length);
            expect(result[0].role).toBe('system');
        });

        it('does not throw on empty summary from provider', async () => {
            const emptyProvider: LLMProvider = {
                name: 'empty-mock',
                async *chat(): AsyncIterable<StreamChunk> {
                    yield { type: 'done' };
                },
            };
            const msgs = makeMessages(25);
            const result = await compressConversationHistory(msgs, emptyProvider, 20);
            expect(result.length).toBeLessThan(msgs.length);
        });
    });

    describe('LLM call frequency', () => {
        it('makes exactly one LLM call per compression', async () => {
            const { provider, getCount } = countingProvider('summary');
            const msgs = makeMessages(25);
            await compressConversationHistory(msgs, provider, 20);
            expect(getCount()).toBe(1);
        });
    });

    describe('handles messages without system prompt', () => {
        it('compresses messages that start with user (no system)', async () => {
            const msgs: Message[] = Array.from({ length: 25 }, (_, i) => ({
                role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
                content: `msg ${i}`,
            }));
            const result = await compressConversationHistory(msgs, mockProvider('no-system summary'), 20);
            expect(result.length).toBeLessThan(msgs.length);
            expect(result[0].role).toBe('user');
            expect(result[0].content).toContain('History Compacted');
        });
    });
});
