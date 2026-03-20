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
        '[MANDATORY] Use this tool to reason privately BEFORE creating a todo plan or taking any significant action. '
        + 'You MUST call think when: the task is ambiguous, involves 2+ files, requires architecture decisions, '
        + 'you hit an error and need to choose a fix, or you need to weigh trade-offs. '
        + 'Think deeply: consider edge cases, risks, alternative approaches, and conclude with a clear action plan. '
        + 'No side effects — this is pure internal reasoning. Never skip this to save tokens.',
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
