// ─── Persistent memory system ───

import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename, resolve } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const MEMORY_DIR = join(homedir(), '.deepa', 'memory');

// ─── Constants ───
const INDEX_MAX_LINES = 200;
const INDEX_MAX_BYTES = 25_000;
const MEMORY_SCAN_MAX_FILES = 200;
const STALENESS_THRESHOLD_DAYS = 1;

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
    // Enforce both line and byte limits (like Claude Code)
    if (lines.length > INDEX_MAX_LINES) {
        return lines.slice(0, INDEX_MAX_LINES).join('\n') +
            `\n\n> WARNING: ${source} memory index exceeded ${INDEX_MAX_LINES} lines and was truncated. Move details to individual files!`;
    }
    if (Buffer.byteLength(content, 'utf-8') > INDEX_MAX_BYTES) {
        // Truncate by bytes — find the last full line that fits
        let byteCount = 0;
        let lastSafeLine = 0;
        for (let i = 0; i < lines.length; i++) {
            byteCount += Buffer.byteLength(lines[i] + '\n', 'utf-8');
            if (byteCount > INDEX_MAX_BYTES) break;
            lastSafeLine = i;
        }
        return lines.slice(0, lastSafeLine + 1).join('\n') +
            `\n\n> WARNING: ${source} memory index exceeded ${Math.round(INDEX_MAX_BYTES / 1024)}KB and was truncated. Move details to individual files!`;
    }
    return content;
}

// ─── Memory Age & Staleness ───

export interface MemoryFileInfo {
    path: string;
    name: string;
    ageDays: number;
    frontmatter?: MemoryFrontmatter;
}

export interface MemoryFrontmatter {
    name?: string;
    description?: string;
    type?: 'user' | 'feedback' | 'project' | 'reference';
}

/**
 * Calculate the age of a memory file in days based on its mtime.
 */
export function memoryAgeDays(filePath: string): number {
    if (!existsSync(filePath)) return 0;
    const stat = statSync(filePath);
    const ms = Date.now() - stat.mtimeMs;
    return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Generate a freshness caveat for a memory based on its age.
 * Returns null if the memory is fresh (< STALENESS_THRESHOLD_DAYS).
 */
export function memoryFreshnessCaveat(ageDays: number): string | null {
    if (ageDays < STALENESS_THRESHOLD_DAYS) return null;
    if (ageDays < 7) return `(${ageDays}d old — verify before acting on it)`;
    if (ageDays < 30) return `(${Math.floor(ageDays / 7)}w old — claims about code behavior may be outdated)`;
    return `(${Math.floor(ageDays / 30)}mo old — likely stale, verify against current code)`;
}

/**
 * Parse simple YAML frontmatter from a memory file.
 */
export function parseFrontmatter(content: string): { frontmatter: MemoryFrontmatter; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: content };

    const fm: MemoryFrontmatter = {};
    for (const line of match[1].split('\n')) {
        const kv = line.match(/^(\w+):\s*(.+)$/);
        if (!kv) continue;
        const [, key, val] = kv;
        if (key === 'name') fm.name = val.trim();
        else if (key === 'description') fm.description = val.trim();
        else if (key === 'type' && ['user', 'feedback', 'project', 'reference'].includes(val.trim())) {
            fm.type = val.trim() as MemoryFrontmatter['type'];
        }
    }
    return { frontmatter: fm, body: match[2].trim() };
}

/**
 * Scan a memory directory for .md files (excluding MEMORY.md index).
 * Returns info about each file including age and frontmatter.
 * Caps at MEMORY_SCAN_MAX_FILES to prevent unbounded reads.
 */
export function scanMemoryFiles(dirPath: string): MemoryFileInfo[] {
    if (!existsSync(dirPath)) return [];

    const files: MemoryFileInfo[] = [];
    try {
        const entries = readdirSync(dirPath).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
        for (const entry of entries.slice(0, MEMORY_SCAN_MAX_FILES)) {
            const fullPath = join(dirPath, entry);
            try {
                const stat = statSync(fullPath);
                if (!stat.isFile()) continue;
                const content = readFileSync(fullPath, 'utf-8');
                const { frontmatter } = parseFrontmatter(content);
                const ageDays = Math.floor((Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24));
                files.push({ path: fullPath, name: entry, ageDays, frontmatter });
            } catch {
                // Skip unreadable files
            }
        }
    } catch {
        // Directory unreadable
    }
    return files;
}

/**
 * Build a staleness-annotated memory index.
 * Appends freshness caveats to index entries that have matching memory files.
 */
export function annotateIndexWithStaleness(indexContent: string, memDir: string): string {
    const files = scanMemoryFiles(memDir);
    if (files.length === 0) return indexContent;

    // Build a map: filename → ageDays
    const ageMap = new Map<string, number>();
    for (const f of files) {
        ageMap.set(f.name, f.ageDays);
    }

    // Annotate each index line that references a file
    return indexContent.split('\n').map(line => {
        // Match markdown link: [Title](filename.md)
        const linkMatch = line.match(/\[.*?\]\(([^)]+\.md)\)/);
        if (!linkMatch) return line;
        const filename = linkMatch[1];
        const age = ageMap.get(filename);
        if (age === undefined) return line;
        const caveat = memoryFreshnessCaveat(age);
        if (!caveat) return line;
        return `${line} ${caveat}`;
    }).join('\n');
}

// ─── Cache ───
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

/** Clear the memory cache. Called after compression and for testing. */
export function clearMemoryCache(): void {
    indexCache.clear();
}

/**
 * Load the primary memory indexes (Global + Project) for the main agent system prompt.
 * Read-only: does NOT create directories as a side effect.
 * Annotates entries with staleness caveats when memory files are > 1 day old.
 */
export function loadPrimaryMemoryIndex(cwd: string): string {
    const cacheKey = `primary:${cwd}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const parts: string[] = [];

    // Global memory index
    const globalDir = resolveMemoryDir('global');
    const globalIndex = safeRead(join(globalDir, 'MEMORY.md'));
    if (globalIndex) {
        const annotated = annotateIndexWithStaleness(truncateIndex(globalIndex, 'Global'), globalDir);
        parts.push(`### Global Memory Index (\`~/.deepa/memory/global/MEMORY.md\`)\n${annotated}`);
    } else {
        parts.push(`### Global Memory Index (\`~/.deepa/memory/global/MEMORY.md\`)\n*Empty. Create file to start remembering global preferences.*`);
    }

    // Project memory index
    const projDir = resolveMemoryDir(`projects/${projectKey(cwd)}`);
    const projIndex = safeRead(join(projDir, 'MEMORY.md'));
    if (projIndex) {
        const annotated = annotateIndexWithStaleness(truncateIndex(projIndex, 'Project'), projDir);
        parts.push(`### Project Memory Index (\`${projDir}/MEMORY.md\`)\n${annotated}`);
    } else {
        parts.push(`### Project Memory Index (\`${projDir}/MEMORY.md\`)\n*Empty. Create file to start tracking project nuances.*`);
    }

    const result = parts.join('\n\n');
    setCache(cacheKey, result);
    return result;
}

/**
 * Load the specific memory index for a given subagent.
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

// ─── Exported constants for testing ───
export const _testing = {
    MEMORY_DIR,
    INDEX_MAX_LINES,
    INDEX_MAX_BYTES,
    MEMORY_SCAN_MAX_FILES,
    STALENESS_THRESHOLD_DAYS,
    projectKey,
};
