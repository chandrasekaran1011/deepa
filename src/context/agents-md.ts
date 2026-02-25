// ─── AGENTS.md / CLAUDE.md loader ───

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONTEXT_FILES = ['AGENTS.md', 'CLAUDE.md', '.agents.md'];

/**
 * Load project context from AGENTS.md and similar files.
 * Searches: project root, then global ~/.deepa/
 */
export function loadAgentsMd(cwd: string): string | undefined {
    const parts: string[] = [];

    // Global context
    const globalDir = join(homedir(), '.deepa');
    for (const filename of CONTEXT_FILES) {
        const globalPath = join(globalDir, filename);
        if (existsSync(globalPath)) {
            parts.push(`# Global Context (${filename})\n\n${readFileSync(globalPath, 'utf-8')}`);
        }
    }

    // Project context
    for (const filename of CONTEXT_FILES) {
        const projectPath = join(cwd, filename);
        if (existsSync(projectPath)) {
            parts.push(`# Project Context (${filename})\n\n${readFileSync(projectPath, 'utf-8')}`);
        }
    }

    return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined;
}
