// ─── File write tool ───

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { resolvePath } from './resolve-path.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    path: z.string().nullable().describe('Absolute or relative path to write to'),
    content: z.string().nullable().describe('File content to write'),
    createDirectories: z.boolean().optional().nullable().default(true).describe('Create parent directories if they don\'t exist'),
});

export const fileWriteTool: Tool = {
    name: 'file_write',
    description: 'Write string/text content to a file. Creates the file if it doesn\'t exist, or overwrites if it does. Parent directories are created automatically. DO NOT use this for binary files like .pptx, .xlsx, or .pdf (write a script instead).',
    parameters,
    safetyLevel: 'cautious',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { path: filePath, content, createDirectories } = params as z.infer<typeof parameters>;

        if (!filePath) {
            return { content: 'Error: "path" is required for file_write', isError: true };
        }
        if (!content && content !== '') {
            return { content: 'Error: "content" is required for file_write', isError: true };
        }

        const absPath = resolvePath(filePath, context.cwd);
        const dir = dirname(absPath);
        const existed = existsSync(absPath);

        // Prevent LLM from attempting to write binary formats directly
        const lowerPath = absPath.toLowerCase();
        if (lowerPath.endsWith('.pptx') || lowerPath.endsWith('.xlsx') || lowerPath.endsWith('.pdf') || lowerPath.endsWith('.docx')) {
            return {
                content: 'Error: Cannot write raw binary formats (.pptx, .xlsx, .pdf, .docx) using file_write. You MUST write a Node.js/Python script to generate the file programmatically, and then run that script with the shell tool.',
                isError: true,
            };
        }

        if (createDirectories && !existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        writeFileSync(absPath, content, 'utf-8');
        const lines = content.split('\n').length;

        return {
            content: `${existed ? 'Updated' : 'Created'} file: ${absPath} (${lines} lines)`,
        };
    },
};
