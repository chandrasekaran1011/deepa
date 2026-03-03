// ─── Agent loop tests ───
// Tests the core think→act→verify loop with mock LLM providers and tools

import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop } from '../../src/agent/loop.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { z } from 'zod';
import type { LLMProvider } from '../../src/providers/base.js';
import type { StreamChunk, DeepaConfig, Message } from '../../src/types.js';

// ─── Helpers ───────────────────────────────────────────────

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
        async *chat() {
            for (const chunk of chunks) yield chunk;
        },
    };
}

/** Provider that behaves differently on first vs subsequent calls */
function makeStatefulProvider(firstChunks: StreamChunk[], subsequentChunks: StreamChunk[]): LLMProvider {
    let callCount = 0;
    return {
        name: 'mock-stateful',
        async *chat() {
            callCount++;
            const chunks = callCount === 1 ? firstChunks : subsequentChunks;
            for (const chunk of chunks) yield chunk;
        },
    };
}

function makeRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register({
        name: 'echo',
        description: 'Echo a message',
        parameters: z.object({ msg: z.string() }),
        riskLevel: 'low',
        execute: async (params) => ({ content: `echoed: ${(params as { msg: string }).msg}` }),
    });
    registry.register({
        name: 'fail_tool',
        description: 'Always fails',
        parameters: z.object({}),
        riskLevel: 'low',
        execute: async () => ({ content: 'tool error', isError: true }),
    });
    registry.register({
        name: 'big_output',
        description: 'Returns large output',
        parameters: z.object({}),
        riskLevel: 'low',
        execute: async () => ({ content: 'x'.repeat(20_000) }),
    });
    return registry;
}

function makeOptions(provider: LLMProvider, registry?: ToolRegistry) {
    return {
        provider,
        tools: registry ?? makeRegistry(),
        config: makeConfig(),
        cwd: '/tmp',
        confirmAction: async () => true as const,
    };
}

// ─── Tests ─────────────────────────────────────────────────

describe('Agent Loop', () => {

    describe('Basic text responses', () => {
        it('returns assistant message when LLM responds with plain text', async () => {
            const provider = makeProvider([
                { type: 'text', text: 'Hello there!' },
                { type: 'done' },
            ]);
            const messages = await runAgentLoop('hi', [], makeOptions(provider));
            const last = messages[messages.length - 1];
            expect(last.role).toBe('assistant');
            expect(last.content).toBe('Hello there!');
        });

        it('accumulates streaming text chunks into a single message', async () => {
            const provider = makeProvider([
                { type: 'text', text: 'Part1' },
                { type: 'text', text: ' Part2' },
                { type: 'text', text: ' Part3' },
                { type: 'done' },
            ]);
            const messages = await runAgentLoop('hi', [], makeOptions(provider));
            const last = messages[messages.length - 1];
            expect(last.content).toBe('Part1 Part2 Part3');
        });

        it('includes user message in returned history', async () => {
            const provider = makeProvider([
                { type: 'text', text: 'ok' },
                { type: 'done' },
            ]);
            const messages = await runAgentLoop('hello world', [], makeOptions(provider));
            const userMsg = messages.find((m) => m.role === 'user');
            expect(userMsg?.content).toBe('<user_input>\nhello world\n</user_input>');
        });

        it('preserves prior conversation history', async () => {
            const prior: Message[] = [
                { role: 'user', content: 'first question' },
                { role: 'assistant', content: 'first answer' },
            ];
            const provider = makeProvider([
                { type: 'text', text: 'second answer' },
                { type: 'done' },
            ]);
            const messages = await runAgentLoop('second question', prior, makeOptions(provider));
            expect(messages.length).toBeGreaterThanOrEqual(4); // prior(2) + new user + assistant
        });

        it('does not include system prompt in returned messages', async () => {
            const provider = makeProvider([
                { type: 'text', text: 'response' },
                { type: 'done' },
            ]);
            const messages = await runAgentLoop('hi', [], makeOptions(provider));
            expect(messages.every((m) => m.role !== 'system')).toBe(true);
        });
    });

    describe('Tool call execution', () => {
        it('executes a tool call and feeds result back to LLM', async () => {
            const provider = makeStatefulProvider(
                // First turn: tool call
                [
                    { type: 'tool_call', id: 'tc1', name: 'echo', arguments: '{"msg":"hello"}' },
                    { type: 'done' },
                ],
                // Second turn: text response using tool result
                [
                    { type: 'text', text: 'Tool executed successfully' },
                    { type: 'done' },
                ],
            );
            const messages = await runAgentLoop('call echo', [], makeOptions(provider));
            // Should have: user, assistant(tool_call), tool(result), assistant(text)
            expect(messages.some((m) => m.role === 'tool')).toBe(true);
            const last = messages[messages.length - 1];
            expect(last.role).toBe('assistant');
            expect(last.content).toBe('Tool executed successfully');
        });

        it('includes tool result content in the tool message', async () => {
            const provider = makeStatefulProvider(
                [
                    { type: 'tool_call', id: 'tc1', name: 'echo', arguments: '{"msg":"world"}' },
                    { type: 'done' },
                ],
                [{ type: 'text', text: 'done' }, { type: 'done' }],
            );
            const messages = await runAgentLoop('test', [], makeOptions(provider));
            const toolMsg = messages.find((m) => m.role === 'tool');
            expect(toolMsg).toBeDefined();
            const content = toolMsg!.content;
            expect(JSON.stringify(content)).toContain('echoed: world');
        });

        it('handles malformed tool call JSON gracefully', async () => {
            const provider = makeStatefulProvider(
                [
                    { type: 'tool_call', id: 'tc1', name: 'echo', arguments: '{bad json' },
                    { type: 'done' },
                ],
                [{ type: 'text', text: 'done' }, { type: 'done' }],
            );
            // Should not throw
            await expect(runAgentLoop('test', [], makeOptions(provider))).resolves.toBeDefined();
        });

        it('fires onToolCall and onToolResult callbacks', async () => {
            const onToolCall = vi.fn();
            const onToolResult = vi.fn();
            const provider = makeStatefulProvider(
                [
                    { type: 'tool_call', id: 'tc1', name: 'echo', arguments: '{"msg":"cb"}' },
                    { type: 'done' },
                ],
                [{ type: 'text', text: 'ok' }, { type: 'done' }],
            );
            await runAgentLoop('test', [], {
                ...makeOptions(provider),
                onToolCall,
                onToolResult,
            });
            expect(onToolCall).toHaveBeenCalledWith('echo', { msg: 'cb' });
            expect(onToolResult).toHaveBeenCalledOnce();
            expect(onToolResult.mock.calls[0][0]).toBe('echo');
            expect(onToolResult.mock.calls[0][1]).toContain('echoed: cb');
        });

        it('handles unknown tool name gracefully (returns error tool result)', async () => {
            const provider = makeStatefulProvider(
                [
                    { type: 'tool_call', id: 'tc1', name: 'nonexistent_tool', arguments: '{}' },
                    { type: 'done' },
                ],
                [{ type: 'text', text: 'handled error' }, { type: 'done' }],
            );
            const messages = await runAgentLoop('test', [], makeOptions(provider));
            const toolMsg = messages.find((m) => m.role === 'tool');
            expect(JSON.stringify(toolMsg?.content)).toContain('Unknown tool');
        });

        it('handles tool execution error (isError result)', async () => {
            const provider = makeStatefulProvider(
                [
                    { type: 'tool_call', id: 'tc1', name: 'fail_tool', arguments: '{}' },
                    { type: 'done' },
                ],
                [{ type: 'text', text: 'saw error' }, { type: 'done' }],
            );
            const onToolResult = vi.fn();
            await runAgentLoop('test', [], { ...makeOptions(provider), onToolResult });
            expect(onToolResult).toHaveBeenCalledWith('fail_tool', 'tool error', true);
        });
    });

    describe('Token usage tracking', () => {
        it('calls onTokenUsage with usage data', async () => {
            const onTokenUsage = vi.fn();
            const provider = makeProvider([
                { type: 'text', text: 'hi' },
                { type: 'done', usage: { promptTokens: 100, completionTokens: 50 } },
            ]);
            await runAgentLoop('test', [], { ...makeOptions(provider), onTokenUsage });
            expect(onTokenUsage).toHaveBeenCalledWith(100, 50, 100, 50);
        });

        it('accumulates token usage across multiple turns', async () => {
            const onTokenUsage = vi.fn();
            const provider = makeStatefulProvider(
                [
                    { type: 'tool_call', id: 'tc1', name: 'echo', arguments: '{"msg":"x"}' },
                    { type: 'done', usage: { promptTokens: 100, completionTokens: 10 } },
                ],
                [
                    { type: 'text', text: 'done' },
                    { type: 'done', usage: { promptTokens: 200, completionTokens: 20 } },
                ],
            );
            await runAgentLoop('test', [], { ...makeOptions(provider), onTokenUsage });
            // Second call should have cumulative totals
            const lastCall = onTokenUsage.mock.calls[onTokenUsage.mock.calls.length - 1];
            expect(lastCall[2]).toBe(300); // total prompt
            expect(lastCall[3]).toBe(30);  // total completion
        });

        it('skips onTokenUsage when done chunk has no usage', async () => {
            const onTokenUsage = vi.fn();
            const provider = makeProvider([
                { type: 'text', text: 'hi' },
                { type: 'done' }, // no usage field
            ]);
            await runAgentLoop('test', [], { ...makeOptions(provider), onTokenUsage });
            expect(onTokenUsage).not.toHaveBeenCalled();
        });
    });

    describe('Error handling', () => {
        it('returns messages collected so far when LLM yields an error', async () => {
            const provider = makeProvider([
                { type: 'error', error: 'API timeout' },
            ]);
            const messages = await runAgentLoop('hi', [], makeOptions(provider));
            // Should return without throwing
            expect(Array.isArray(messages)).toBe(true);
        });

        it('fires onText callback for each text chunk', async () => {
            const onText = vi.fn();
            const provider = makeProvider([
                { type: 'text', text: 'A' },
                { type: 'text', text: 'B' },
                { type: 'done' },
            ]);
            await runAgentLoop('test', [], { ...makeOptions(provider), onText });
            expect(onText).toHaveBeenCalledWith('A');
            expect(onText).toHaveBeenCalledWith('B');
        });
    });

    describe('Tool output truncation', () => {
        it('truncates tool output exceeding 8000 characters', async () => {
            const onToolResult = vi.fn();
            const provider = makeStatefulProvider(
                [
                    { type: 'tool_call', id: 'tc1', name: 'big_output', arguments: '{}' },
                    { type: 'done' },
                ],
                [{ type: 'text', text: 'done' }, { type: 'done' }],
            );
            await runAgentLoop('test', [], { ...makeOptions(provider), onToolResult });
            const resultContent: string = onToolResult.mock.calls[0][1];
            expect(resultContent).toContain('truncated');
            expect(resultContent.length).toBeLessThan(20_000);
        });
    });

    describe('Max iterations guard', () => {
        it('stops after MAX_ITERATIONS and does not loop forever', async () => {
            // Provider always returns a tool call so the loop never terminates naturally
            let callCount = 0;
            const provider: LLMProvider = {
                name: 'infinite-mock',
                async *chat() {
                    callCount++;
                    yield { type: 'tool_call', id: `tc${callCount}`, name: 'echo', arguments: '{"msg":"loop"}' };
                    yield { type: 'done' };
                },
            };
            const messages = await runAgentLoop('loop', [], makeOptions(provider));
            expect(Array.isArray(messages)).toBe(true);
            // Should have stopped at 50 iterations max
            expect(callCount).toBeLessThanOrEqual(51);
        }, 15_000);
    });
});
