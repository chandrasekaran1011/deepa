// ─── File read tool ───

import { readFileSync, existsSync, statSync } from 'fs';
import { resolvePath } from './resolve-path.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const MAX_SIZE = 256 * 1024; // 256KB

const parameters = z.object({
    path: z.string().describe('Absolute or relative path to the file to read'),
    startLine: z.number().optional().describe('Start line (1-indexed, inclusive)'),
    endLine: z.number().optional().describe('End line (1-indexed, inclusive)'),
});

export const fileReadTool: Tool = {
    name: 'file_read',
    description: 'Read the contents of a file. Supports optional line range. Returns file content as text.',
    parameters,
    riskLevel: 'low',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { path: filePath, startLine, endLine } = params as z.infer<typeof parameters>;
        const absPath = resolvePath(filePath, context.cwd);

        if (!existsSync(absPath)) {
            return { content: `Error: File not found: ${absPath}`, isError: true };
        }

        const stats = statSync(absPath);
        if (stats.isDirectory()) {
            return { content: `Error: Path is a directory, not a file: ${absPath}`, isError: true };
        }

        if (stats.size > MAX_SIZE) {
            return {
                content: `Error: File too large (${(stats.size / 1024).toFixed(1)}KB). Max size: ${MAX_SIZE / 1024}KB. Use line ranges to read portions.`,
                isError: true,
            };
        }

        const content = readFileSync(absPath, 'utf-8');
        const lines = content.split('\n');
        const totalLines = lines.length;

        // Auto-pagination: Enforce max 500 lines per read to protect LLM context
        const MAX_LINES_PER_READ = 500;

        let start = Math.max(1, startLine ?? 1);
        let end = endLine ?? (start + MAX_LINES_PER_READ - 1);

        // Ensure requested range respects the max limit
        if (end - start + 1 > MAX_LINES_PER_READ) {
            end = start + MAX_LINES_PER_READ - 1;
        }

        start = Math.max(1, start);
        end = Math.min(totalLines, end);

        const slice = lines.slice(start - 1, end);
        let output = slice.map((l, i) => `${start + i}: ${l}`).join('\n');

        const isFullyRead = start === 1 && end === totalLines;

        if (isFullyRead) {
            return {
                content: `File: ${absPath} (${totalLines} lines)\n\n${output}`,
            };
        } else {
            let note = `\n\n[Note: This file has ${totalLines} lines. Lines ${start}-${end} are shown.`;
            if (end < totalLines) {
                note += ` To read more, call file_read again with startLine: ${end + 1}, endLine: ${Math.min(totalLines, end + MAX_LINES_PER_READ)}.]`;
            } else {
                note += `]`;
            }
            return {
                content: `File: ${absPath} (Showing lines ${start}-${end} of ${totalLines})\n\n${output}${note}`,
            };
        }
    },
};
