// ─── Git Worktree isolation tool (Codex Best Practice) ───

import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { resolvePath } from './resolve-path.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    action: z.enum(['create', 'list', 'remove']).describe('Action: create a new worktree, list them, or remove one'),
    branchName: z.string().optional().describe('Name of the new branch/worktree (for create action)'),
    path: z.string().optional().describe('Relative path to mount the worktree, e.g., "../.worktrees/task1" (for create/remove actions)'),
});

export const gitWorktreeTool: Tool = {
    name: 'git_worktree',
    description: 'Manage Git Worktrees to create isolated, safe environments for experimental changes or complex refactoring, without polluting the main branch. This allows "multi-threaded" agent workspaces.',
    parameters,
    safetyLevel: 'cautious', // Require permission before branching/mounting new worktrees

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { action, branchName, path } = params as z.infer<typeof parameters>;

        switch (action) {
            case 'list': {
                try {
                    const output = execSync('git worktree list', { cwd: context.cwd, encoding: 'utf-8' });
                    return { content: `Active Git Worktrees:\n\n${output}` };
                } catch (e: any) {
                    return { content: `Failed to list worktrees: ${e.message}`, isError: true };
                }
            }

            case 'create': {
                if (!branchName || !path) {
                    return { content: 'Error: branchName and path are required to create a worktree', isError: true };
                }

                try {
                    // Resolve path (but allow going slightly out-of-repo if it's securely managed)
                    // Git worktrees are often stored in `../` adjacent to the main repo
                    const resolvedPath = resolvePath(path, context.cwd);

                    if (await context.confirmAction(`Create isolated git worktree '${branchName}' at ${resolvedPath}?`)) {
                        mkdirSync(dirname(resolvedPath), { recursive: true });
                        const cmd = `git worktree add -b ${branchName} ${resolvedPath}`;
                        const output = execSync(cmd, { cwd: context.cwd, encoding: 'utf-8' });
                        return { content: `Successfully created isolated worktree:\n${output}\n\nTo use it, change your working directory or pass it to future tool calls: ${resolvedPath}` };
                    } else {
                        return { content: 'Operation cancelled by user.' };
                    }
                } catch (e: any) {
                    return { content: `Error creating worktree: ${e.message}\nMake sure you are in a valid git repository.`, isError: true };
                }
            }

            case 'remove': {
                if (!path) {
                    return { content: 'Error: path is required to remove a worktree', isError: true };
                }

                try {
                    const resolvedPath = resolvePath(path, context.cwd);
                    if (await context.confirmAction(`Remove git worktree at ${resolvedPath}? (This will delete the folder)`)) {
                        const cmd = `git worktree remove --force ${resolvedPath}`;
                        const output = execSync(cmd, { cwd: context.cwd, encoding: 'utf-8' });
                        return { content: `Successfully removed worktree:\n${output}` };
                    } else {
                        return { content: 'Operation cancelled by user.' };
                    }
                } catch (e: any) {
                    return { content: `Error removing worktree: ${e.message}`, isError: true };
                }
            }
        }
    },
};
