// ─── File search tool (find by name/glob) ───

import { execSync } from 'child_process';
import { resolvePath } from './resolve-path.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    pattern: z.string().describe('Glob or Regex pattern to search for (e.g., "*.ts", "test*", ".*innovation.*")'),
    path: z.string().optional().default('.').describe('Directory to search in'),
    type: z.enum(['file', 'directory', 'any']).optional().default('any').describe('Filter by type'),
    maxDepth: z.number().optional().describe('Maximum search depth'),
    maxResults: z.number().optional().default(50).describe('Maximum results'),
    isRegex: z.boolean().optional().default(false).describe('If true, treat pattern as a regular expression instead of a glob'),
});

export const searchFilesTool: Tool = {
    name: 'search_files',
    description: 'Find files and directories by name pattern (glob or regex). Searches are case-insensitive by default. Like the `fd` or `find` command.',
    parameters,
    safetyLevel: 'safe',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { pattern, path: searchPath, type, maxDepth, maxResults, isRegex } = params as z.infer<typeof parameters>;
        const absPath = resolvePath(searchPath, context.cwd);

        // Try fd first, fall back to find
        let cmd: string;
        let args: string[];

        try {
            execSync('which fd', { stdio: 'ignore' });
            cmd = 'fd';
            args = [];
            if (!isRegex) args.push('-g'); // glob mode
            args.push('-i'); // always case-insensitive

            if (type === 'file') args.push('-t', 'f');
            else if (type === 'directory') args.push('-t', 'd');
            if (maxDepth) args.push('-d', String(maxDepth));
            args.push('--max-results', String(maxResults));

            args.push(pattern, absPath);
        } catch {
            cmd = 'find';
            args = [absPath];
            if (maxDepth) args.push('-maxdepth', String(maxDepth));
            if (type === 'file') args.push('-type', 'f');
            else if (type === 'directory') args.push('-type', 'd');

            if (isRegex) {
                // Approximate regex with find by using case-insensitive regex
                args.push('-iregex', `.*${pattern}.*`);
            } else {
                // Use case-insensitive glob
                args.push('-iname', pattern);
            }
        }

        try {
            const output = execSync(`${cmd} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
                encoding: 'utf-8',
                maxBuffer: 1024 * 1024,
                timeout: 15000,
            }).trim();

            if (!output) {
                return { content: `No files found matching "${pattern}" in ${absPath}` };
            }

            const files = output.split('\n').slice(0, maxResults);
            return {
                content: `Found ${files.length} result(s) matching "${pattern}":\n\n${files.join('\n')}`,
            };
        } catch (err) {
            const error = err as Error;
            return { content: `File search error: ${error.message}`, isError: true };
        }
    },
};
