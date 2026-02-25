// ─── File edit tool (search-and-replace) ───

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolvePath } from './resolve-path.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    path: z.string().describe('Path to the file to edit'),
    search: z.string().describe('Exact text to search for (must match precisely)'),
    replace: z.string().describe('Replacement text'),
    replaceAll: z.boolean().optional().default(false).describe('Replace all occurrences'),
});

export const fileEditTool: Tool = {
    name: 'file_edit',
    description: 'Edit a file by replacing exact text matches. Specify the exact string to find and its replacement. Use replaceAll to replace all occurrences.',
    parameters,
    safetyLevel: 'cautious',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { path: filePath, search, replace, replaceAll } = params as z.infer<typeof parameters>;
        const absPath = resolvePath(filePath, context.cwd);

        if (!existsSync(absPath)) {
            return { content: `Error: File not found: ${absPath}`, isError: true };
        }

        let content = readFileSync(absPath, 'utf-8');
        const occurrences = content.split(search).length - 1;

        if (occurrences === 0) {
            return {
                content: `Error: Search text not found in ${absPath}.\n\nSearch text:\n${search}`,
                isError: true,
            };
        }

        if (replaceAll) {
            content = content.replaceAll(search, replace);
        } else {
            content = content.replace(search, replace);
        }

        writeFileSync(absPath, content, 'utf-8');

        return {
            content: `Edited ${absPath}: replaced ${replaceAll ? occurrences : 1} occurrence(s)`,
        };
    },
};
