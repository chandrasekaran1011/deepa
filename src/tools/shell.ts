// ─── Shell execution tool ───

import { spawn } from 'child_process';
import { resolvePath } from './resolve-path.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    command: z.string().describe('Shell command to execute'),
    cwd: z.string().nullish().describe('Working directory (optional)'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds (default: 30s)'),
});

export const shellTool: Tool = {
    name: 'shell',
    description: 'Execute a shell command. Use for running tests, builds, git operations, or launching scripts. NEVER use this tool to write complex inline scripts (e.g., `node -e "..."`, `python -c "..."`, awkward bash pipelines, or heredocs). Instead, write the code to a proper file using file_write, execute the file with this shell tool, and then delete it.',
    parameters,
    safetyLevel: 'dangerous',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { command, cwd, timeout } = params as z.infer<typeof parameters>;
        const workDir = resolvePath(cwd || '.', context.cwd);

        context.log(`$ ${command}`);

        return new Promise<ToolResult>((resolvePromise) => {
            const child = spawn('sh', ['-c', command], {
                cwd: workDir,
                env: { ...process.env, PAGER: 'cat' },
                timeout,
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', (err) => {
                resolvePromise({
                    content: `Command failed to start: ${err.message}`,
                    isError: true,
                });
            });

            child.on('close', (code) => {
                const output: string[] = [];
                if (stdout.trim()) output.push(`stdout:\n${stdout.trim()}`);
                if (stderr.trim()) output.push(`stderr:\n${stderr.trim()}`);
                output.push(`\nExit code: ${code}`);

                resolvePromise({
                    content: output.join('\n\n'),
                    isError: code !== 0,
                });
            });
        });
    },
};
