// ─── File list / directory listing tool ───

import { readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { resolvePath } from './resolve-path.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    path: z.string().optional().default('.').describe('Directory path to list'),
    maxDepth: z.number().optional().default(2).describe('Maximum depth to recurse (default: 2)'),
    showHidden: z.boolean().optional().default(false).describe('Show hidden files (starting with .)'),
});

const IGNORED = new Set([
    'node_modules', '.git', '__pycache__', '.next', 'dist', '.DS_Store',
    '.venv', 'venv', 'coverage', '.cache', '.turbo',
]);

function listDir(
    dirPath: string,
    basePath: string,
    depth: number,
    maxDepth: number,
    showHidden: boolean,
): string[] {
    if (depth > maxDepth) return [];

    const entries = readdirSync(dirPath, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
        if (!showHidden && entry.name.startsWith('.')) continue;
        if (IGNORED.has(entry.name)) continue;

        const fullPath = join(dirPath, entry.name);
        const relPath = relative(basePath, fullPath);

        if (entry.isDirectory()) {
            results.push(`📁 ${relPath}/`);
            if (depth < maxDepth) {
                results.push(...listDir(fullPath, basePath, depth + 1, maxDepth, showHidden));
            }
        } else {
            const stats = statSync(fullPath);
            const size = formatSize(stats.size);
            results.push(`📄 ${relPath} (${size})`);
        }
    }

    return results;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const fileListTool: Tool = {
    name: 'file_list',
    description: 'List directory contents with file sizes. Ignores common build artifacts (node_modules, .git, dist). Supports configurable depth.',
    parameters,
    riskLevel: 'low',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { path: dirPath, maxDepth, showHidden } = params as z.infer<typeof parameters>;
        const absPath = resolvePath(dirPath, context.cwd);

        if (!existsSync(absPath)) {
            return { content: `Error: Directory not found: ${absPath}`, isError: true };
        }

        const items = listDir(absPath, absPath, 0, maxDepth, showHidden);

        if (items.length === 0) {
            return { content: `Directory is empty: ${absPath}` };
        }

        return {
            content: `Directory: ${absPath}\n\n${items.join('\n')}`,
        };
    },
};
