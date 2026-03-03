// ─── Persistent memory system ───

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, basename, resolve } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const MEMORY_DIR = join(homedir(), '.deepa', 'memory');

function ensureMemoryDir(subdir?: string): string {
    const dir = subdir ? join(MEMORY_DIR, subdir) : MEMORY_DIR;
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * Generate a collision-resistant project key from the full resolved path.
 * Uses the directory basename + a short SHA-1 hash of the absolute path so
 * two projects named "api" in different directories never share memory.
 */
function projectKey(cwd: string): string {
    const abs = resolve(cwd);
    const hash = createHash('sha1').update(abs).digest('hex').slice(0, 8);
    const name = basename(abs).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${name}_${hash}`;
}

/**
 * Load all memory (global + project-specific) as a string for context injection.
 */
export function loadMemory(cwd: string): string | undefined {
    const parts: string[] = [];

    // Global memory
    const globalDir = ensureMemoryDir('global');
    if (existsSync(globalDir)) {
        const files = readdirSync(globalDir).filter((f) => f.endsWith('.md'));
        for (const file of files) {
            const content = readFileSync(join(globalDir, file), 'utf-8').trim();
            if (content) parts.push(`## ${file.replace('.md', '')}\n${content}`);
        }
    }

    // Project memory
    const projDir = ensureMemoryDir(`projects/${projectKey(cwd)}`);
    if (existsSync(projDir)) {
        const files = readdirSync(projDir).filter((f) => f.endsWith('.md'));
        for (const file of files) {
            const content = readFileSync(join(projDir, file), 'utf-8').trim();
            if (content) parts.push(`## ${file.replace('.md', '')} (project)\n${content}`);
        }
    }

    return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/**
 * Save a memory entry.
 */
export function saveMemory(
    key: string,
    content: string,
    scope: 'global' | 'project',
    cwd: string,
): void {
    const dir =
        scope === 'global'
            ? ensureMemoryDir('global')
            : ensureMemoryDir(`projects/${projectKey(cwd)}`);

    const filePath = join(dir, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`);
    writeFileSync(filePath, content, 'utf-8');
}

/**
 * List all memory keys.
 */
export function listMemory(cwd: string): { key: string; scope: string }[] {
    const results: { key: string; scope: string }[] = [];

    const globalDir = join(MEMORY_DIR, 'global');
    if (existsSync(globalDir)) {
        for (const file of readdirSync(globalDir).filter((f) => f.endsWith('.md'))) {
            results.push({ key: file.replace('.md', ''), scope: 'global' });
        }
    }

    const projDir = join(MEMORY_DIR, 'projects', projectKey(cwd));
    if (existsSync(projDir)) {
        for (const file of readdirSync(projDir).filter((f) => f.endsWith('.md'))) {
            results.push({ key: file.replace('.md', ''), scope: 'project' });
        }
    }

    return results;
}

/**
 * Read a single memory entry by key. Checks project scope first, then global.
 */
export function readMemoryByKey(key: string, cwd: string): { content: string; scope: string } | undefined {
    const sanitized = key.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Check project scope first
    const projDir = join(MEMORY_DIR, 'projects', projectKey(cwd));
    const projFile = join(projDir, `${sanitized}.md`);
    if (existsSync(projFile)) {
        return { content: readFileSync(projFile, 'utf-8').trim(), scope: 'project' };
    }

    // Check global scope
    const globalFile = join(MEMORY_DIR, 'global', `${sanitized}.md`);
    if (existsSync(globalFile)) {
        return { content: readFileSync(globalFile, 'utf-8').trim(), scope: 'global' };
    }

    return undefined;
}

/**
 * List all memory keys with a one-line preview of each entry's content.
 */
export function listMemoryWithPreview(cwd: string): { key: string; scope: string; preview: string }[] {
    const results: { key: string; scope: string; preview: string }[] = [];

    const globalDir = join(MEMORY_DIR, 'global');
    if (existsSync(globalDir)) {
        for (const file of readdirSync(globalDir).filter((f) => f.endsWith('.md'))) {
            const content = readFileSync(join(globalDir, file), 'utf-8').trim();
            const preview = content.split('\n')[0].slice(0, 80);
            results.push({ key: file.replace('.md', ''), scope: 'global', preview });
        }
    }

    const projDir = join(MEMORY_DIR, 'projects', projectKey(cwd));
    if (existsSync(projDir)) {
        for (const file of readdirSync(projDir).filter((f) => f.endsWith('.md'))) {
            const content = readFileSync(join(projDir, file), 'utf-8').trim();
            const preview = content.split('\n')[0].slice(0, 80);
            results.push({ key: file.replace('.md', ''), scope: 'project', preview });
        }
    }

    return results;
}
