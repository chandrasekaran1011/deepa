// ─── Memory tool ───
// Exposes the persistent memory system as a tool the agent can call.
// Wraps context/memory.ts to allow read, save, and list operations.

import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';
import { saveMemory, loadMemory, listMemory } from '../context/memory.js';

const parameters = z.object({
    action: z.enum(['read', 'save', 'list']).describe(
        'read: load all saved memories. save: store a new memory. list: show all memory keys.',
    ),
    key: z.string().optional().describe(
        'Memory key name (required for save). Use descriptive, snake_case names like "project_conventions" or "user_preferences".',
    ),
    content: z.string().optional().describe(
        'Content to save (required for save action). Use markdown for structured notes.',
    ),
    scope: z.enum(['global', 'project']).optional().default('project').describe(
        'global: remembered across all projects. project: only for this workspace.',
    ),
});

export const memoryTool: Tool = {
    name: 'memory',
    description:
        'Read, save, or list persistent memories that survive across sessions. '
        + 'Use this to remember: user preferences, project conventions, coding patterns, '
        + 'architectural decisions, or anything you should know next time. '
        + 'Memories are stored as markdown files in ~/.deepa/memory/.',
    parameters,
    riskLevel: 'low',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { action, key, content, scope } = params as z.infer<typeof parameters>;

        switch (action) {
            case 'read': {
                const memory = loadMemory(context.cwd);
                if (!memory) {
                    return { content: 'No memories saved yet. Use memory(action: "save") to store information.' };
                }
                return { content: `Saved memories:\n\n${memory}` };
            }

            case 'save': {
                if (!key) {
                    return {
                        content: 'Error: "key" is required for save action. Use a descriptive snake_case name.',
                        isError: true,
                    };
                }
                if (!content) {
                    return {
                        content: 'Error: "content" is required for save action.',
                        isError: true,
                    };
                }

                const resolvedScope = scope ?? 'project';
                saveMemory(key, content, resolvedScope, context.cwd);

                return {
                    content: `Memory saved: "${key}" (${resolvedScope} scope). This will be available in future sessions.`,
                };
            }

            case 'list': {
                const entries = listMemory(context.cwd);
                if (entries.length === 0) {
                    return { content: 'No memories saved yet.' };
                }
                const formatted = entries
                    .map((e) => `- ${e.key} (${e.scope})`)
                    .join('\n');
                return { content: `Saved memory keys:\n${formatted}` };
            }

            default:
                return { content: `Unknown action: ${action}`, isError: true };
        }
    },
};
