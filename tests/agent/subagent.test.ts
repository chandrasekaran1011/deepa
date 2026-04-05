// ─── Subagent system tests ───
// Tests spawn depth limits, maxTurns enforcement, abort signal propagation,
// and context forking/stripping behavior.

import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop, MAX_SPAWN_DEPTH } from '../../src/agent/loop.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { z } from 'zod';
import type { LLMProvider } from '../../src/providers/base.js';
import type { StreamChunk, DeepaConfig, Message, ToolContext } from '../../src/types.js';

// ─── Helpers ──────────────────────────────────────

function makeConfig(overrides: Partial<DeepaConfig> = {}): DeepaConfig {
    return {
        provider: { type: 'openai', model: 'gpt-4o', maxTokens: 4096 },
        autonomy: 'high',
        mode: 'chat',
        mcpServers: {},
        verbose: false,
        ...overrides,
    };
}

function makeProvider(chunks: StreamChunk[]): LLMProvider {
    return {
        name: 'mock',
        async *chat() { for (const c of chunks) yield c; },
    };
}

function statefulProvider(first: StreamChunk[], rest: StreamChunk[]): LLMProvider {
    let call = 0;
    return {
        name: 'stateful',
        async *chat() {
            call++;
            for (const c of call === 1 ? first : rest) yield c;
        },
    };
}

function makeOptions(provider: LLMProvider, overrides: Record<string, any> = {}) {
    return {
        provider,
        tools: new ToolRegistry(),
        config: makeConfig(),
        cwd: '/tmp',
        confirmAction: async () => true as const,
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────

describe('Subagent System', () => {

    describe('maxIterations enforcement', () => {
        it('respects custom maxIterations option', async () => {
            let callCount = 0;
            const registry = new ToolRegistry();
            registry.register({
                name: 'echo',
                description: 'Echo',
                parameters: z.object({ msg: z.string() }),
                riskLevel: 'low',
                execute: async (p) => ({ content: `echoed: ${(p as any).msg}` }),
            });

            const provider: LLMProvider = {
                name: 'loop-mock',
                async *chat() {
                    callCount++;
                    yield { type: 'tool_call', id: `tc${callCount}`, name: 'echo', arguments: '{"msg":"x"}' };
                    yield { type: 'done' };
                },
            };

            await runAgentLoop('loop', [], {
                ...makeOptions(provider, { tools: registry }),
                maxIterations: 5,
            });

            expect(callCount).toBeLessThanOrEqual(6); // 5 iterations + possible 1 extra
        });

        it('defaults to 50 iterations when not specified', async () => {
            let callCount = 0;
            const registry = new ToolRegistry();
            registry.register({
                name: 'noop',
                description: 'Noop',
                parameters: z.object({}),
                riskLevel: 'low',
                execute: async () => ({ content: 'ok' }),
            });

            const provider: LLMProvider = {
                name: 'loop-mock',
                async *chat() {
                    callCount++;
                    yield { type: 'tool_call', id: `tc${callCount}`, name: 'noop', arguments: '{}' };
                    yield { type: 'done' };
                },
            };

            await runAgentLoop('test', [], makeOptions(provider, { tools: registry }));
            expect(callCount).toBeLessThanOrEqual(55);
            expect(callCount).toBeGreaterThan(10);
        }, 15_000);

        it('maxIterations=1 runs exactly one LLM call', async () => {
            let callCount = 0;
            const registry = new ToolRegistry();
            registry.register({
                name: 'noop',
                description: 'Noop',
                parameters: z.object({}),
                riskLevel: 'low',
                execute: async () => ({ content: 'ok' }),
            });

            const provider: LLMProvider = {
                name: 'once',
                async *chat() {
                    callCount++;
                    yield { type: 'tool_call', id: 'tc1', name: 'noop', arguments: '{}' };
                    yield { type: 'done' };
                },
            };

            await runAgentLoop('test', [], {
                ...makeOptions(provider, { tools: registry }),
                maxIterations: 1,
            });
            expect(callCount).toBe(1);
        });
    });

    describe('spawnDepth tracking', () => {
        it('starts at depth 0 by default', async () => {
            let capturedDepth = -1;
            const registry = new ToolRegistry();
            registry.register({
                name: 'depth_check',
                description: 'Check depth',
                parameters: z.object({}),
                riskLevel: 'low',
                execute: async (_p, ctx) => {
                    capturedDepth = ctx.spawnDepth ?? -1;
                    return { content: `depth=${capturedDepth}` };
                },
            });

            const provider = statefulProvider(
                [{ type: 'tool_call', id: 'tc1', name: 'depth_check', arguments: '{}' }, { type: 'done' }],
                [{ type: 'text', text: 'done' }, { type: 'done' }],
            );

            await runAgentLoop('check', [], makeOptions(provider, { tools: registry }));
            expect(capturedDepth).toBe(0);
        });

        it('passes spawnDepth to tool context', async () => {
            let capturedDepth = -1;
            const registry = new ToolRegistry();
            registry.register({
                name: 'depth_check',
                description: 'Check depth',
                parameters: z.object({}),
                riskLevel: 'low',
                execute: async (_p, ctx) => {
                    capturedDepth = ctx.spawnDepth ?? -1;
                    return { content: `depth=${capturedDepth}` };
                },
            });

            const provider = statefulProvider(
                [{ type: 'tool_call', id: 'tc1', name: 'depth_check', arguments: '{}' }, { type: 'done' }],
                [{ type: 'text', text: 'done' }, { type: 'done' }],
            );

            await runAgentLoop('check', [], {
                ...makeOptions(provider, { tools: registry }),
                spawnDepth: 3,
            });
            expect(capturedDepth).toBe(3);
        });

        it('MAX_SPAWN_DEPTH is a positive integer', () => {
            expect(MAX_SPAWN_DEPTH).toBeGreaterThan(0);
            expect(Number.isInteger(MAX_SPAWN_DEPTH)).toBe(true);
        });
    });

    describe('abort signal propagation', () => {
        it('passes signal to tool context', async () => {
            let capturedSignal: AbortSignal | undefined;
            const registry = new ToolRegistry();
            registry.register({
                name: 'sig_check',
                description: 'Signal check',
                parameters: z.object({}),
                riskLevel: 'low',
                execute: async (_p, ctx) => {
                    capturedSignal = ctx.signal;
                    return { content: 'ok' };
                },
            });

            const controller = new AbortController();
            const provider = statefulProvider(
                [{ type: 'tool_call', id: 'tc1', name: 'sig_check', arguments: '{}' }, { type: 'done' }],
                [{ type: 'text', text: 'done' }, { type: 'done' }],
            );

            await runAgentLoop('check', [], {
                ...makeOptions(provider, { tools: registry }),
                signal: controller.signal,
            });
            expect(capturedSignal).toBe(controller.signal);
        });

        it('aborts loop when signal is triggered before tool execution', async () => {
            const controller = new AbortController();
            const registry = new ToolRegistry();
            registry.register({
                name: 'slow',
                description: 'Slow tool',
                parameters: z.object({}),
                riskLevel: 'low',
                execute: async () => {
                    // Should not reach here
                    return { content: 'should not execute' };
                },
            });

            let callCount = 0;
            const provider: LLMProvider = {
                name: 'abort-mock',
                async *chat() {
                    callCount++;
                    if (callCount === 1) {
                        yield { type: 'tool_call', id: 'tc1', name: 'slow', arguments: '{}' };
                        yield { type: 'done' };
                    } else {
                        // Abort before second call
                        controller.abort();
                        yield { type: 'text', text: 'cancelled' };
                        yield { type: 'done' };
                    }
                },
            };

            // Abort immediately
            controller.abort();
            const messages = await runAgentLoop('test', [], {
                ...makeOptions(provider, { tools: registry }),
                signal: controller.signal,
            });
            expect(messages.some(m => typeof m.content === 'string' && m.content.includes('Cancelled'))).toBe(true);
        });
    });

    describe('message filtering', () => {
        it('filters out info messages from API calls', async () => {
            let apiMessagesReceived: Message[] = [];
            const provider: LLMProvider = {
                name: 'spy',
                async *chat(msgs) {
                    apiMessagesReceived = msgs;
                    yield { type: 'text', text: 'ok' };
                    yield { type: 'done' };
                },
            };

            const history: Message[] = [
                { role: 'user', content: 'hello' },
                { role: 'info', content: 'system notice' },
                { role: 'assistant', content: 'hi' },
            ];

            await runAgentLoop('test', history, makeOptions(provider));
            expect(apiMessagesReceived.some(m => m.role === 'info')).toBe(false);
        });

        it('filters out mid-conversation system messages from API calls', async () => {
            let apiMessagesReceived: Message[] = [];
            const provider: LLMProvider = {
                name: 'spy',
                async *chat(msgs) {
                    apiMessagesReceived = msgs;
                    yield { type: 'text', text: 'ok' };
                    yield { type: 'done' };
                },
            };

            const history: Message[] = [
                { role: 'user', content: 'hello' },
                { role: 'assistant', content: 'hi' },
                { role: 'system', content: 'injected system message' },
                { role: 'user', content: 'follow up' },
            ];

            await runAgentLoop('test', history, makeOptions(provider));
            // Only the first system message (system prompt) should be present
            const systemMsgs = apiMessagesReceived.filter(m => m.role === 'system');
            expect(systemMsgs.length).toBe(1);
            expect(systemMsgs[0].content).not.toContain('injected');
        });

        it('keeps the first system message (system prompt) in API calls', async () => {
            let apiMessagesReceived: Message[] = [];
            const provider: LLMProvider = {
                name: 'spy',
                async *chat(msgs) {
                    apiMessagesReceived = msgs;
                    yield { type: 'text', text: 'ok' };
                    yield { type: 'done' };
                },
            };

            await runAgentLoop('test', [], makeOptions(provider));
            expect(apiMessagesReceived[0].role).toBe('system');
        });
    });

    describe('askSubagent context isolation', () => {
        it('askSubagent is available in toolContext', async () => {
            let hasAskSubagent = false;
            const registry = new ToolRegistry();
            registry.register({
                name: 'check_sub',
                description: 'Check subagent',
                parameters: z.object({}),
                riskLevel: 'low',
                execute: async (_p, ctx) => {
                    hasAskSubagent = typeof ctx.askSubagent === 'function';
                    return { content: 'ok' };
                },
            });

            const provider = statefulProvider(
                [{ type: 'tool_call', id: 'tc1', name: 'check_sub', arguments: '{}' }, { type: 'done' }],
                [{ type: 'text', text: 'done' }, { type: 'done' }],
            );

            await runAgentLoop('check', [], makeOptions(provider, { tools: registry }));
            expect(hasAskSubagent).toBe(true);
        });
    });
});
