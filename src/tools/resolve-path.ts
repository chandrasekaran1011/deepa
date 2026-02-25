// ─── Path resolution utility ───
// Resolves paths with ~ expansion and relative-to-cwd handling

import { resolve, isAbsolute } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

/**
 * Resolve a path: expands ~ to home dir, resolves relative to cwd.
 */
export function resolvePath(inputPath: string, cwd: string): string {
    // Expand ~ and ~/ to home directory
    if (inputPath === '~') {
        return homedir();
    }
    if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
        return resolve(homedir(), inputPath.slice(2));
    }

    // Absolute paths stay as-is (but could be absolute paths within the sandbox)
    const resolvedPath = isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);

    // Enforce Sandboxing Strategy (Codex Best Practice)
    // 1. If the path targets the global ~/.deepa config dir, allow it always
    const homeDir = homedir();
    const deepaDir = resolve(homeDir, '.deepa');
    if (resolvedPath.startsWith(deepaDir)) {
        return resolvedPath;
    }

    // 2. Otherwise, enforce that it stays within the current workspace (git root or cwd)
    let workspaceRoot = cwd;

    // Simplistic discovery: find the .git folder by walking up from cwd
    let currentDir = cwd;
    while (currentDir !== resolve(currentDir, '..')) {
        if (existsSync(resolve(currentDir, '.git'))) {
            workspaceRoot = currentDir;
            break;
        }
        currentDir = resolve(currentDir, '..');
    }

    // 3. Explicitly allow sibling `.worktrees` directories (Codex best practice for branch isolation)
    const siblingWorktreesDir = resolve(workspaceRoot, '../.worktrees');
    if (resolvedPath.startsWith(siblingWorktreesDir)) {
        return resolvedPath;
    }

    // If the resolved path points to somewhere explicitly OUTSIDE of the workspace root and allowed exceptions
    if (!resolvedPath.startsWith(workspaceRoot)) {
        throw new Error(`[Security Sandbox] Access to ${resolvedPath} is forbidden. You are restricted to your workspace root: ${workspaceRoot}`);
    }

    return resolvedPath;
}
