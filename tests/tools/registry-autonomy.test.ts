// ─── Registry autonomy gate & output truncation tests ───

import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import { z } from 'zod';
import type { ToolContext } from '../../src/types.js';

function makeContext(
    autonomy: 'low' | 'medium' | 'high',
    confirmAction?: (desc: string) => Promise<boolean | string>,
): ToolContext {
    return {
        cwd: '/tmp',
        autonomy,
        confirmAction: confirmAction ?? (async () => true),
        log: () => {},
    };
}

function makeRegistry() {
    const registry = new ToolRegistry();

    registry.register({
        name: 'safe_tool',
        description: 'Safe tool',
        parameters: z.object({}),
        riskLevel: 'low',
        execute: async () => ({ content: 'safe_result' }),
    });

    registry.register({
        name: 'cautious_tool',
        description: 'Cautious tool',
        parameters: z.object({}),
        riskLevel: 'medium',
        execute: async () => ({ content: 'cautious_result' }),
    });

    registry.register({
        name: 'dangerous_tool',
        description: 'Dangerous tool',
        parameters: z.object({}),
        riskLevel: 'very-high',
        execute: async () => ({ content: 'dangerous_result' }),
    });

    registry.register({
        name: 'big_tool',
        description: 'Returns 20k chars',
        parameters: z.object({}),
        riskLevel: 'low',
        execute: async () => ({ content: 'A'.repeat(20_000) }),
    });

    return registry;
}

// ─── Autonomy gate truth table ─────────────────────────────
//
//  autonomy \ safety | safe | cautious | dangerous
//  ──────────────────+──────+──────────+──────────
//  suggest           | ASK  | ASK      | ASK
//  ask               | auto | ASK      | ASK
//  auto              | auto | auto     | ASK

describe('Registry autonomy gate', () => {
    const registry = makeRegistry();

    describe('suggest mode — ALL tools need confirmation', () => {
        it('safe tool asks for confirmation', async () => {
            const confirm = vi.fn(async () => true as const);
            await registry.execute('safe_tool', {}, makeContext('low', confirm));
            expect(confirm).toHaveBeenCalledOnce();
        });

        it('cautious tool asks for confirmation', async () => {
            const confirm = vi.fn(async () => true as const);
            await registry.execute('cautious_tool', {}, makeContext('low', confirm));
            expect(confirm).toHaveBeenCalledOnce();
        });

        it('dangerous tool asks for confirmation', async () => {
            const confirm = vi.fn(async () => true as const);
            await registry.execute('dangerous_tool', {}, makeContext('low', confirm));
            expect(confirm).toHaveBeenCalledOnce();
        });

        it('cancels execution when user returns false', async () => {
            const result = await registry.execute(
                'safe_tool', {},
                makeContext('low', async () => false),
            );
            expect(result.isError).toBe(true);
            expect(result.content).toContain('cancelled');
        });

        it('returns user feedback when user provides a string', async () => {
            const result = await registry.execute(
                'safe_tool', {},
                makeContext('low', async () => 'use a different approach'),
            );
            expect(result.isError).toBe(true);
            expect(result.content).toContain('use a different approach');
        });
    });

    describe('medium mode — low/medium auto, high/very-high ask', () => {
        it('safe tool (low risk) runs without confirmation', async () => {
            const confirm = vi.fn(async () => true as const);
            const result = await registry.execute('safe_tool', {}, makeContext('medium', confirm));
            expect(confirm).not.toHaveBeenCalled();
            expect(result.content).toBe('safe_result');
        });

        it('cautious tool (medium risk) runs without confirmation', async () => {
            const confirm = vi.fn(async () => true as const);
            const result = await registry.execute('cautious_tool', {}, makeContext('medium', confirm));
            expect(confirm).not.toHaveBeenCalled();
            expect(result.content).toBe('cautious_result');
        });

        it('dangerous tool (very-high risk) asks for confirmation', async () => {
            const confirm = vi.fn(async () => true as const);
            await registry.execute('dangerous_tool', {}, makeContext('medium', confirm));
            expect(confirm).toHaveBeenCalledOnce();
        });
    });

    describe('auto mode — only dangerous asks', () => {
        it('safe tool runs without confirmation', async () => {
            const confirm = vi.fn(async () => true as const);
            const result = await registry.execute('safe_tool', {}, makeContext('high', confirm));
            expect(confirm).not.toHaveBeenCalled();
            expect(result.content).toBe('safe_result');
        });

        it('cautious tool runs without confirmation', async () => {
            const confirm = vi.fn(async () => true as const);
            const result = await registry.execute('cautious_tool', {}, makeContext('high', confirm));
            expect(confirm).not.toHaveBeenCalled();
            expect(result.content).toBe('cautious_result');
        });

        it('dangerous tool asks for confirmation even in auto mode', async () => {
            const confirm = vi.fn(async () => true as const);
            await registry.execute('dangerous_tool', {}, makeContext('high', confirm));
            expect(confirm).toHaveBeenCalledOnce();
        });
    });
});

// ─── Output truncation ─────────────────────────────────────

describe('Registry output truncation', () => {
    const registry = makeRegistry();

    it('truncates output exceeding 8000 chars', async () => {
        const result = await registry.execute('big_tool', {}, makeContext('high'));
        expect(result.content.length).toBeLessThan(20_000);
        expect(result.content).toContain('truncated');
    });

    it('preserves the first 8000 chars of output', async () => {
        const result = await registry.execute('big_tool', {}, makeContext('high'));
        // First 8000 chars should be all 'A's
        expect(result.content.startsWith('A'.repeat(100))).toBe(true);
    });

    it('does not truncate output under 8000 chars', async () => {
        const result = await registry.execute('safe_tool', {}, makeContext('high'));
        expect(result.content).toBe('safe_result');
        expect(result.content).not.toContain('truncated');
    });

    it('mentions character count in truncation notice', async () => {
        const result = await registry.execute('big_tool', {}, makeContext('high'));
        expect(result.content).toMatch(/\d+.*characters omitted/i);
    });
});
