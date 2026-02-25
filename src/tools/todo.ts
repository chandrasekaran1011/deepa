// ─── Todo / plan tracking tool ───

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { resolvePath } from './resolve-path.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    action: z.enum(['read', 'write', 'toggle']).describe('Action: read current plan, write a new plan, or toggle a task'),
    content: z.string().optional().nullable().describe('Plan content in markdown (for write action)'),
    taskIndex: z.number().optional().nullable().describe('Task index to toggle (0-based, for toggle action)'),
});

const PLAN_FILENAME = '.deepa/plan.md';

export const todoTool: Tool = {
    name: 'todo',
    description: 'Manage a task plan (todo list). Use "write" to create/update the plan, "read" to view it, "toggle" to mark items complete/incomplete. Plans use markdown checkboxes ([ ] / [x]).',
    parameters,
    safetyLevel: 'safe',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { action, content, taskIndex } = params as z.infer<typeof parameters>;
        const planPath = resolvePath(PLAN_FILENAME, context.cwd);

        switch (action) {
            case 'read': {
                if (!existsSync(planPath)) {
                    return { content: 'No plan exists yet. Use action "write" to create one.' };
                }
                const data = readFileSync(planPath, 'utf-8');
                return { content: `Current plan:\n\n${data}` };
            }

            case 'write': {
                if (!content) {
                    return { content: 'Error: content is required for write action', isError: true };
                }
                const dir = dirname(planPath);
                if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                writeFileSync(planPath, content, 'utf-8');
                const taskCount = (content.match(/^[\s]*[-*]\s*\[[ x/]\]/gm) || []).length;
                return { content: `Plan updated at ${planPath} (${taskCount} tasks)\n\n${content}` };
            }

            case 'toggle': {
                if (taskIndex === undefined) {
                    return { content: 'Error: taskIndex is required for toggle action', isError: true };
                }
                if (!existsSync(planPath)) {
                    return { content: 'Error: No plan exists to toggle tasks in', isError: true };
                }

                const data = readFileSync(planPath, 'utf-8');
                const lines = data.split('\n');
                let checkboxCount = 0;

                for (let i = 0; i < lines.length; i++) {
                    const match = lines[i].match(/^(\s*[-*]\s*)\[([ x/])\](.*)$/);
                    if (match) {
                        if (checkboxCount === taskIndex) {
                            const current = match[2];
                            const next = current === 'x' ? ' ' : 'x';
                            lines[i] = `${match[1]}[${next}]${match[3]}`;
                            writeFileSync(planPath, lines.join('\n'), 'utf-8');
                            return {
                                content: `Toggled task ${taskIndex}: [${current}] → [${next}]\n\n${lines[i].trim()}`,
                            };
                        }
                        checkboxCount++;
                    }
                }

                return {
                    content: `Error: Task index ${taskIndex} not found (${checkboxCount} tasks exist)`,
                    isError: true,
                };
            }
        }
    },
};
