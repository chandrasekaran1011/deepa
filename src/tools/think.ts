// ─── Think tool ───
// Provides the agent with a dedicated space for step-by-step reasoning
// before taking action. No side effects — purely internal reasoning.

import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    thought: z.string().describe(
        'Your step-by-step reasoning about the problem. Include analysis, trade-offs, '
        + 'alternative approaches, and your conclusion on how to proceed.',
    ),
});

export const thinkTool: Tool = {
    name: 'think',
    description:
        'Use this tool to think through complex problems step-by-step BEFORE taking action. '
        + 'Call this when you need to: reason about architecture decisions, plan multi-file changes, '
        + 'analyze tricky bugs, weigh trade-offs between approaches, or break down a complex task. '
        + 'This is for YOUR internal reasoning only — no side effects, no file changes.',
    parameters,
    riskLevel: 'low',

    async execute(params: unknown, _context: ToolContext): Promise<ToolResult> {
        const { thought } = params as z.infer<typeof parameters>;
        const lines = thought.split('\n').length;
        const words = thought.split(/\s+/).filter(Boolean).length;
        return {
            content: `[Reasoning recorded — ${words} words, ${lines} lines. Continue with your plan.]`,
        };
    },
};
