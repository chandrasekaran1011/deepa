import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import { z } from 'zod';
import type { ToolResult, ToolContext } from '../../src/types.js';

function makeContext(autonomy: 'suggest' | 'ask' | 'auto' = 'auto'): ToolContext {
    return {
        cwd: '/tmp',
        autonomy,
        confirmAction: async () => true,
        log: () => { },
    };
}

describe('Tool Registry', () => {
    it('registers and retrieves tools', () => {
        const registry = new ToolRegistry();
        registry.register({
            name: 'test_tool',
            description: 'A test tool',
            parameters: z.object({ msg: z.string() }),
            safetyLevel: 'safe',
            execute: async () => ({ content: 'ok' }),
        });

        expect(registry.get('test_tool')).toBeDefined();
        expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('lists all registered tools', () => {
        const registry = new ToolRegistry();
        registry.register({
            name: 'tool_a',
            description: 'A',
            parameters: z.object({}),
            safetyLevel: 'safe',
            execute: async () => ({ content: '' }),
        });
        registry.register({
            name: 'tool_b',
            description: 'B',
            parameters: z.object({}),
            safetyLevel: 'safe',
            execute: async () => ({ content: '' }),
        });

        expect(registry.list()).toHaveLength(2);
    });

    it('generates JSON Schema tool definitions', () => {
        const registry = new ToolRegistry();
        registry.register({
            name: 'greet',
            description: 'Say hello',
            parameters: z.object({ name: z.string() }),
            safetyLevel: 'safe',
            execute: async () => ({ content: 'hi' }),
        });

        const defs = registry.getDefinitions();
        expect(defs).toHaveLength(1);
        expect(defs[0].name).toBe('greet');
        expect(defs[0].description).toBe('Say hello');
        expect(defs[0].parameters).toBeDefined();
    });

    it('executes a tool and returns result', async () => {
        const registry = new ToolRegistry();
        registry.register({
            name: 'echo',
            description: 'Echo back',
            parameters: z.object({ msg: z.string() }),
            safetyLevel: 'safe',
            execute: async (params) => {
                const { msg } = params as { msg: string };
                return { content: `echo: ${msg}` };
            },
        });

        const result = await registry.execute('echo', { msg: 'hello' }, makeContext());
        expect(result.content).toBe('echo: hello');
    });

    it('returns error for unknown tool', async () => {
        const registry = new ToolRegistry();
        const result = await registry.execute('nonexistent', {}, makeContext());
        expect(result.isError).toBe(true);
        expect(result.content).toContain('Unknown tool');
    });

    it('validates parameters with Zod', async () => {
        const registry = new ToolRegistry();
        registry.register({
            name: 'typed',
            description: 'Typed tool',
            parameters: z.object({ count: z.number() }),
            safetyLevel: 'safe',
            execute: async () => ({ content: 'ok' }),
        });

        const result = await registry.execute('typed', { count: 'not a number' }, makeContext());
        expect(result.isError).toBe(true);
        expect(result.content).toContain('Invalid parameters');
    });
});
