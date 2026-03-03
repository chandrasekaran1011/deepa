// ─── Grep / code search tool ───

import { execSync } from 'child_process';
import { resolvePath } from './resolve-path.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    query: z.string().describe('Search pattern (text or regex)'),
    path: z.string().optional().default('.').describe('Directory or file to search in'),
    isRegex: z.boolean().optional().default(false).describe('Treat query as regex'),
    caseInsensitive: z.boolean().optional().default(false).describe('Case-insensitive search'),
    includes: z.array(z.string()).optional().describe('Glob patterns to include (e.g., "*.ts")'),
    maxResults: z.number().optional().default(50).describe('Max results to return'),
});

export const searchGrepTool: Tool = {
    name: 'search_grep',
    description: 'Search for text patterns across files using ripgrep-style search. Returns matching lines with file names and line numbers.',
    parameters,
    riskLevel: 'low',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { query, path: searchPath, isRegex, caseInsensitive, includes, maxResults } = params as z.infer<typeof parameters>;
        const absPath = resolvePath(searchPath, context.cwd);

        // Build grep command - try rg first, fall back to grep
        const args: string[] = [];
        let cmd: string;
        const isWin = process.platform === 'win32';

        try {
            execSync(isWin ? 'where rg' : 'which rg', { stdio: 'ignore' });
            cmd = 'rg';
            args.push('--json', '-n');
            if (!isRegex) args.push('-F');
            if (caseInsensitive) args.push('-i');
            if (maxResults) args.push('-m', String(maxResults));
            if (includes) {
                for (const pattern of includes) {
                    args.push('-g', pattern);
                }
            }
            args.push('--', query, absPath);
        } catch {
            cmd = 'grep';
            args.push('-rn');
            if (!isRegex) args.push('-F');
            if (caseInsensitive) args.push('-i');
            if (includes?.length) {
                for (const pattern of includes) {
                    args.push('--include', pattern);
                }
            }
            args.push('--', query, absPath);
        }

        try {
            const quote = isWin
                ? (a: string) => `"${a.replace(/"/g, '\\"')}"`
                : (a: string) => `'${a.replace(/'/g, "'\\''")}'`;
            const output = execSync(`${cmd} ${args.map(quote).join(' ')}`, {
                encoding: 'utf-8',
                maxBuffer: 1024 * 1024,
                timeout: 30000,
            }).trim();

            if (!output) {
                return { content: `No matches found for "${query}" in ${absPath}` };
            }

            // Parse results
            if (cmd === 'rg') {
                const lines = output.split('\n').filter(Boolean);
                const matches: string[] = [];
                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.type === 'match') {
                            const file = data.data.path.text;
                            const lineNum = data.data.line_number;
                            const text = data.data.lines.text.trimEnd();
                            matches.push(`${file}:${lineNum}: ${text}`);
                        }
                    } catch {
                        // Skip non-JSON lines
                    }
                }
                return {
                    content: `Found ${matches.length} match(es) for "${query}":\n\n${matches.join('\n')}`,
                };
            }

            // Plain grep output
            const lines = output.split('\n').slice(0, maxResults);
            return {
                content: `Found ${lines.length} match(es) for "${query}":\n\n${lines.join('\n')}`,
            };
        } catch (err) {
            const error = err as { status?: number; stderr?: string } & Error;
            if (error.status === 1) {
                return { content: `No matches found for "${query}" in ${absPath}` };
            }
            return { content: `Search error: ${error.message}`, isError: true };
        }
    },
};
