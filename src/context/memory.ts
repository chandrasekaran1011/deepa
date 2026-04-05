// ─── Persistent memory system ───

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename, resolve } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const MEMORY_DIR = join(homedir(), '.deepa', 'memory');

/** Only create directories when explicitly requested (write operations) */
function ensureMemoryDir(subdir?: string): string {
    const dir = subdir ? join(MEMORY_DIR, subdir) : MEMORY_DIR;
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/** Resolve the directory path without creating it */
function resolveMemoryDir(subdir?: string): string {
    return subdir ? join(MEMORY_DIR, subdir) : MEMORY_DIR;
}

/**
 * Generate a collision-resistant project key from the full resolved path.
 */
function projectKey(cwd: string): string {
    const abs = resolve(cwd);
    const hash = createHash('sha1').update(abs).digest('hex').slice(0, 8);
    const name = basename(abs).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${name}_${hash}`;
}

function safeRead(filePath: string): string | undefined {
    if (existsSync(filePath)) {
        return readFileSync(filePath, 'utf-8').trim();
    }
    return undefined;
}

function truncateIndex(content: string, source: string): string {
    const lines = content.split('\n');
    if (lines.length > 200) {
        return lines.slice(0, 200).join('\n') + `\n\n> WARNING: ${source} memory index exceeded 200 lines and was truncated. Move details to individual files!`;
    }
    return content;
}

// ─── Cache ───
// Avoid re-reading the filesystem on every agent turn. Cache invalidates after 30s.
interface CacheEntry {
    value: string;
    timestamp: number;
}
const indexCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

function getCached(key: string): string | undefined {
    const entry = indexCache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
        return entry.value;
    }
    indexCache.delete(key);
    return undefined;
}

function setCache(key: string, value: string): void {
    indexCache.set(key, { value, timestamp: Date.now() });
}

/** Clear the memory cache (useful for testing) */
export function clearMemoryCache(): void {
    indexCache.clear();
}

/**
 * Load the primary memory indexes (Global + Project) for the main agent system prompt.
 * This looks for `MEMORY.md` which acts as the hierarchical index table.
 *
 * Read-only: does NOT create directories as a side effect.
 */
export function loadPrimaryMemoryIndex(cwd: string): string {
    const cacheKey = `primary:${cwd}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const parts: string[] = [];

    // Global memory index — read only, don't create dir
    const globalDir = resolveMemoryDir('global');
    const globalIndex = safeRead(join(globalDir, 'MEMORY.md'));
    if (globalIndex) {
        parts.push(`### Global Memory Index (\`~/.deepa/memory/global/MEMORY.md\`)\n${truncateIndex(globalIndex, 'Global')}`);
    } else {
        parts.push(`### Global Memory Index (\`~/.deepa/memory/global/MEMORY.md\`)\n*Empty. Create file to start remembering global preferences.*`);
    }

    // Project memory index — read only, don't create dir
    const projDir = resolveMemoryDir(`projects/${projectKey(cwd)}`);
    const projIndex = safeRead(join(projDir, 'MEMORY.md'));
    if (projIndex) {
        parts.push(`### Project Memory Index (\`${projDir}/MEMORY.md\`)\n${truncateIndex(projIndex, 'Project')}`);
    } else {
        parts.push(`### Project Memory Index (\`${projDir}/MEMORY.md\`)\n*Empty. Create file to start tracking project nuances.*`);
    }

    const result = parts.join('\n\n');
    setCache(cacheKey, result);
    return result;
}

/**
 * Load the specific memory index for a given subagent (e.g. `CodeReviewer`).
 * Read-only: does NOT create directories as a side effect.
 */
export function loadSubagentMemory(agentType: string): string | undefined {
    const cacheKey = `agent:${agentType}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const agentDir = resolveMemoryDir(`agents/${agentType}`);
    const result = safeRead(join(agentDir, 'MEMORY.md'));
    if (result) setCache(cacheKey, result);
    return result;
}

/**
 * Ensure the memory directory exists for write operations.
 * Called by agents before writing memory files.
 */
export function ensureGlobalMemoryDir(): string {
    return ensureMemoryDir('global');
}

export function ensureProjectMemoryDir(cwd: string): string {
    return ensureMemoryDir(`projects/${projectKey(cwd)}`);
}

export function ensureAgentMemoryDir(agentType: string): string {
    return ensureMemoryDir(`agents/${agentType}`);
}
