// ─── Memory system tests ───

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { vi } from 'vitest';

const FAKE_HOME = join(tmpdir(), `deepa-memory-test-home-${Date.now()}`);

vi.mock('os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    return {
        ...actual,
        homedir: () => FAKE_HOME,
    };
});

const {
    loadPrimaryMemoryIndex,
    loadSubagentMemory,
    clearMemoryCache,
    memoryAgeDays,
    memoryFreshnessCaveat,
    parseFrontmatter,
    scanMemoryFiles,
    annotateIndexWithStaleness,
    _testing,
} = await import('../../src/context/memory.js');

const CWD_A = join(tmpdir(), `deepa-proj-a-${Date.now()}`);
const CWD_B = join(tmpdir(), `deepa-proj-a-${Date.now()}-different`);

/** Helper: set a file's mtime to N days ago */
function setFileAge(filePath: string, daysAgo: number): void {
    const pastMs = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
    const pastDate = new Date(pastMs);
    utimesSync(filePath, pastDate, pastDate);
}

/** Helper: create a memory file with optional frontmatter */
function writeMemoryFile(dir: string, name: string, opts: {
    fmName?: string;
    fmDesc?: string;
    fmType?: string;
    body?: string;
    ageDays?: number;
} = {}): string {
    const filePath = join(dir, name);
    let content = '';
    if (opts.fmName || opts.fmDesc || opts.fmType) {
        content += '---\n';
        if (opts.fmName) content += `name: ${opts.fmName}\n`;
        if (opts.fmDesc) content += `description: ${opts.fmDesc}\n`;
        if (opts.fmType) content += `type: ${opts.fmType}\n`;
        content += '---\n';
    }
    content += opts.body || 'Memory content here.';
    writeFileSync(filePath, content);
    if (opts.ageDays !== undefined) {
        setFileAge(filePath, opts.ageDays);
    }
    return filePath;
}

describe('Memory System', () => {
    beforeEach(() => {
        clearMemoryCache();
        mkdirSync(FAKE_HOME, { recursive: true });
        mkdirSync(CWD_A, { recursive: true });
        mkdirSync(CWD_B, { recursive: true });
    });

    afterEach(() => {
        clearMemoryCache();
        rmSync(FAKE_HOME, { recursive: true, force: true });
        rmSync(CWD_A, { recursive: true, force: true });
        rmSync(CWD_B, { recursive: true, force: true });
    });

    // ─── loadPrimaryMemoryIndex ───

    describe('loadPrimaryMemoryIndex', () => {
        it('returns placeholder text when no memory files exist', () => {
            const result = loadPrimaryMemoryIndex(CWD_A);
            expect(result).toContain('Empty');
            expect(result).toContain('Global Memory Index');
            expect(result).toContain('Project Memory Index');
        });

        it('does NOT create directories as a side effect of reading', () => {
            loadPrimaryMemoryIndex(CWD_A);
            const memDir = join(FAKE_HOME, '.deepa', 'memory');
            expect(existsSync(memDir)).toBe(false);
        });

        it('loads global MEMORY.md index when it exists', () => {
            const globalDir = join(FAKE_HOME, '.deepa', 'memory', 'global');
            mkdirSync(globalDir, { recursive: true });
            writeFileSync(join(globalDir, 'MEMORY.md'), '- [Pref](user_prefs.md) — user likes tabs');
            const result = loadPrimaryMemoryIndex(CWD_A);
            expect(result).toContain('user likes tabs');
        });

        it('loads project MEMORY.md index when it exists', () => {
            const projectsDir = join(FAKE_HOME, '.deepa', 'memory', 'projects');
            mkdirSync(projectsDir, { recursive: true });

            // Get the project dir path from the placeholder result
            const result1 = loadPrimaryMemoryIndex(CWD_A);
            const match = result1.match(/`([^`]+\/projects\/[^`/]+)\/MEMORY\.md`/);
            expect(match).not.toBeNull();
            const projDir = match![1];
            mkdirSync(projDir, { recursive: true });
            writeFileSync(join(projDir, 'MEMORY.md'), '- [Auth](auth.md) — uses JWT');

            clearMemoryCache();
            const result2 = loadPrimaryMemoryIndex(CWD_A);
            expect(result2).toContain('uses JWT');
        });

        it('caches results for subsequent calls', () => {
            const globalDir = join(FAKE_HOME, '.deepa', 'memory', 'global');
            mkdirSync(globalDir, { recursive: true });
            writeFileSync(join(globalDir, 'MEMORY.md'), 'cached value');

            const result1 = loadPrimaryMemoryIndex(CWD_A);
            writeFileSync(join(globalDir, 'MEMORY.md'), 'new value');
            const result2 = loadPrimaryMemoryIndex(CWD_A);
            expect(result1).toBe(result2);
            expect(result2).toContain('cached value');
        });

        it('cache invalidates after clearMemoryCache()', () => {
            const globalDir = join(FAKE_HOME, '.deepa', 'memory', 'global');
            mkdirSync(globalDir, { recursive: true });
            writeFileSync(join(globalDir, 'MEMORY.md'), 'old value');
            loadPrimaryMemoryIndex(CWD_A);

            writeFileSync(join(globalDir, 'MEMORY.md'), 'new value');
            clearMemoryCache();
            const result = loadPrimaryMemoryIndex(CWD_A);
            expect(result).toContain('new value');
        });

        it('isolates project memory between different cwds', () => {
            const result1 = loadPrimaryMemoryIndex(CWD_A);
            clearMemoryCache();
            const result2 = loadPrimaryMemoryIndex(CWD_B);

            const matchA = result1.match(/projects\/([^/`]+)/);
            const matchB = result2.match(/projects\/([^/`]+)/);
            expect(matchA).not.toBeNull();
            expect(matchB).not.toBeNull();
            expect(matchA![1]).not.toBe(matchB![1]);
        });

        it('truncates index over 200 lines', () => {
            const globalDir = join(FAKE_HOME, '.deepa', 'memory', 'global');
            mkdirSync(globalDir, { recursive: true });
            const longIndex = Array.from({ length: 250 }, (_, i) => `- line ${i + 1}`).join('\n');
            writeFileSync(join(globalDir, 'MEMORY.md'), longIndex);
            const result = loadPrimaryMemoryIndex(CWD_A);
            expect(result).toContain('WARNING');
            expect(result).toContain('truncated');
            expect(result).toContain('line 200');
            expect(result).not.toContain('line 250');
        });

        it('truncates index over 25KB', () => {
            const globalDir = join(FAKE_HOME, '.deepa', 'memory', 'global');
            mkdirSync(globalDir, { recursive: true });
            // Create 50 lines, each ~600 bytes = ~30KB total (but under 200 lines)
            const bigLines = Array.from({ length: 50 }, (_, i) =>
                `- [Memory ${i}](mem_${i}.md) — ${'x'.repeat(560)}`
            ).join('\n');
            writeFileSync(join(globalDir, 'MEMORY.md'), bigLines);
            const result = loadPrimaryMemoryIndex(CWD_A);
            expect(result).toContain('WARNING');
            expect(result).toMatch(/\d+KB/);
        });

        it('annotates stale memory entries with freshness caveats', () => {
            const globalDir = join(FAKE_HOME, '.deepa', 'memory', 'global');
            mkdirSync(globalDir, { recursive: true });
            writeFileSync(join(globalDir, 'MEMORY.md'), '- [Old](stale.md) — old info\n- [Fresh](fresh.md) — new info');

            // Create stale file (10 days old) and fresh file (today)
            writeMemoryFile(globalDir, 'stale.md', { body: 'old data', ageDays: 10 });
            writeMemoryFile(globalDir, 'fresh.md', { body: 'new data', ageDays: 0 });

            const result = loadPrimaryMemoryIndex(CWD_A);
            // Stale entry should have a caveat
            expect(result).toMatch(/stale\.md.*outdated/);
            // Fresh entry should NOT have a caveat
            const freshLine = result.split('\n').find(l => l.includes('fresh.md'));
            expect(freshLine).not.toContain('verify');
            expect(freshLine).not.toContain('outdated');
        });
    });

    // ─── loadSubagentMemory ───

    describe('loadSubagentMemory', () => {
        it('returns undefined when no agent memory exists', () => {
            const result = loadSubagentMemory('CodeReviewer');
            expect(result).toBeUndefined();
        });

        it('does NOT create directories as a side effect', () => {
            loadSubagentMemory('CodeReviewer');
            const agentDir = join(FAKE_HOME, '.deepa', 'memory', 'agents', 'CodeReviewer');
            expect(existsSync(agentDir)).toBe(false);
        });

        it('loads agent MEMORY.md when it exists', () => {
            const agentDir = join(FAKE_HOME, '.deepa', 'memory', 'agents', 'CodeReviewer');
            mkdirSync(agentDir, { recursive: true });
            writeFileSync(join(agentDir, 'MEMORY.md'), '- Always check for SQL injection');
            const result = loadSubagentMemory('CodeReviewer');
            expect(result).toContain('SQL injection');
        });

        it('caches agent memory on repeated reads', () => {
            const agentDir = join(FAKE_HOME, '.deepa', 'memory', 'agents', 'TestAgent');
            mkdirSync(agentDir, { recursive: true });
            writeFileSync(join(agentDir, 'MEMORY.md'), 'original');
            loadSubagentMemory('TestAgent');

            writeFileSync(join(agentDir, 'MEMORY.md'), 'modified');
            const result = loadSubagentMemory('TestAgent');
            expect(result).toBe('original'); // cached
        });

        it('returns fresh data after cache clear', () => {
            const agentDir = join(FAKE_HOME, '.deepa', 'memory', 'agents', 'TestAgent2');
            mkdirSync(agentDir, { recursive: true });
            writeFileSync(join(agentDir, 'MEMORY.md'), 'original');
            loadSubagentMemory('TestAgent2');

            writeFileSync(join(agentDir, 'MEMORY.md'), 'modified');
            clearMemoryCache();
            const result = loadSubagentMemory('TestAgent2');
            expect(result).toBe('modified');
        });
    });

    // ─── Memory Age & Staleness ───

    describe('memoryAgeDays', () => {
        it('returns 0 for a file that does not exist', () => {
            expect(memoryAgeDays('/nonexistent/file.md')).toBe(0);
        });

        it('returns 0 for a freshly created file', () => {
            const dir = join(FAKE_HOME, 'age-test');
            mkdirSync(dir, { recursive: true });
            const filePath = join(dir, 'fresh.md');
            writeFileSync(filePath, 'fresh');
            // Fresh file should be 0 days old (allow 0 or 1 for edge timing)
            expect(memoryAgeDays(filePath)).toBeLessThanOrEqual(1);
        });

        it('returns correct age for an old file', () => {
            const dir = join(FAKE_HOME, 'age-test');
            mkdirSync(dir, { recursive: true });
            const filePath = join(dir, 'old.md');
            writeFileSync(filePath, 'old');
            setFileAge(filePath, 5);
            const age = memoryAgeDays(filePath);
            // Allow ±1 day tolerance for timing edge cases
            expect(age).toBeGreaterThanOrEqual(4);
            expect(age).toBeLessThanOrEqual(6);
        });

        it('returns correct age for very old file (months)', () => {
            const dir = join(FAKE_HOME, 'age-test');
            mkdirSync(dir, { recursive: true });
            const filePath = join(dir, 'ancient.md');
            writeFileSync(filePath, 'ancient');
            setFileAge(filePath, 45);
            const age = memoryAgeDays(filePath);
            expect(age).toBeGreaterThanOrEqual(44);
            expect(age).toBeLessThanOrEqual(46);
        });
    });

    describe('memoryFreshnessCaveat', () => {
        it('returns null for fresh memories (< 1 day)', () => {
            expect(memoryFreshnessCaveat(0)).toBeNull();
        });

        it('returns day-based caveat for 1-6 day old memories', () => {
            const caveat = memoryFreshnessCaveat(3);
            expect(caveat).toContain('3d old');
            expect(caveat).toContain('verify');
        });

        it('returns week-based caveat for 7-29 day old memories', () => {
            const caveat = memoryFreshnessCaveat(14);
            expect(caveat).toContain('2w old');
            expect(caveat).toContain('outdated');
        });

        it('returns month-based caveat for 30+ day old memories', () => {
            const caveat = memoryFreshnessCaveat(60);
            expect(caveat).toContain('2mo old');
            expect(caveat).toContain('stale');
        });

        it('returns null for exactly 0 days', () => {
            expect(memoryFreshnessCaveat(0)).toBeNull();
        });

        it('returns caveat for exactly 1 day', () => {
            const caveat = memoryFreshnessCaveat(1);
            expect(caveat).toContain('1d old');
        });
    });

    // ─── Frontmatter Parsing ───

    describe('parseFrontmatter', () => {
        it('parses valid frontmatter with all fields', () => {
            const content = `---
name: User role
description: Senior backend engineer
type: user
---
The user is a senior backend engineer.`;
            const { frontmatter, body } = parseFrontmatter(content);
            expect(frontmatter.name).toBe('User role');
            expect(frontmatter.description).toBe('Senior backend engineer');
            expect(frontmatter.type).toBe('user');
            expect(body).toBe('The user is a senior backend engineer.');
        });

        it('handles missing frontmatter gracefully', () => {
            const content = 'Just plain text without frontmatter.';
            const { frontmatter, body } = parseFrontmatter(content);
            expect(frontmatter).toEqual({});
            expect(body).toBe(content);
        });

        it('handles partial frontmatter (missing fields)', () => {
            const content = `---
name: Auth flow
---
Uses JWT tokens.`;
            const { frontmatter, body } = parseFrontmatter(content);
            expect(frontmatter.name).toBe('Auth flow');
            expect(frontmatter.description).toBeUndefined();
            expect(frontmatter.type).toBeUndefined();
            expect(body).toBe('Uses JWT tokens.');
        });

        it('validates type field against allowed values', () => {
            const content = `---
type: invalid_type
---
Content.`;
            const { frontmatter } = parseFrontmatter(content);
            expect(frontmatter.type).toBeUndefined();
        });

        it('accepts all four valid types', () => {
            for (const type of ['user', 'feedback', 'project', 'reference']) {
                const content = `---\ntype: ${type}\n---\nContent.`;
                const { frontmatter } = parseFrontmatter(content);
                expect(frontmatter.type).toBe(type);
            }
        });

        it('handles frontmatter with extra whitespace', () => {
            const content = `---
name:   Spaced Name
description:  Spaced Description
type:  feedback
---
Body text.`;
            const { frontmatter } = parseFrontmatter(content);
            expect(frontmatter.name).toBe('Spaced Name');
            expect(frontmatter.description).toBe('Spaced Description');
            expect(frontmatter.type).toBe('feedback');
        });

        it('handles empty body after frontmatter', () => {
            const content = `---
name: Empty body
---
`;
            const { frontmatter, body } = parseFrontmatter(content);
            expect(frontmatter.name).toBe('Empty body');
            expect(body).toBe('');
        });
    });

    // ─── scanMemoryFiles ───

    describe('scanMemoryFiles', () => {
        it('returns empty array for non-existent directory', () => {
            const result = scanMemoryFiles('/nonexistent/dir');
            expect(result).toEqual([]);
        });

        it('returns empty array for empty directory', () => {
            const dir = join(FAKE_HOME, 'scan-empty');
            mkdirSync(dir, { recursive: true });
            const result = scanMemoryFiles(dir);
            expect(result).toEqual([]);
        });

        it('excludes MEMORY.md from scan results', () => {
            const dir = join(FAKE_HOME, 'scan-exclude');
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'MEMORY.md'), 'index');
            writeFileSync(join(dir, 'note.md'), 'note');
            const result = scanMemoryFiles(dir);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('note.md');
        });

        it('only returns .md files', () => {
            const dir = join(FAKE_HOME, 'scan-md');
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'note.md'), 'note');
            writeFileSync(join(dir, 'data.json'), '{}');
            writeFileSync(join(dir, 'script.sh'), 'echo hi');
            const result = scanMemoryFiles(dir);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('note.md');
        });

        it('parses frontmatter from scanned files', () => {
            const dir = join(FAKE_HOME, 'scan-fm');
            mkdirSync(dir, { recursive: true });
            writeMemoryFile(dir, 'user_role.md', {
                fmName: 'User Role',
                fmDesc: 'Backend engineer',
                fmType: 'user',
                body: 'Details...',
            });
            const result = scanMemoryFiles(dir);
            expect(result).toHaveLength(1);
            expect(result[0].frontmatter?.name).toBe('User Role');
            expect(result[0].frontmatter?.description).toBe('Backend engineer');
            expect(result[0].frontmatter?.type).toBe('user');
        });

        it('includes age information for scanned files', () => {
            const dir = join(FAKE_HOME, 'scan-age');
            mkdirSync(dir, { recursive: true });
            writeMemoryFile(dir, 'old.md', { body: 'old', ageDays: 10 });
            writeMemoryFile(dir, 'new.md', { body: 'new', ageDays: 0 });
            const result = scanMemoryFiles(dir);
            expect(result).toHaveLength(2);
            const oldFile = result.find(f => f.name === 'old.md')!;
            const newFile = result.find(f => f.name === 'new.md')!;
            expect(oldFile.ageDays).toBeGreaterThanOrEqual(9);
            expect(newFile.ageDays).toBeLessThanOrEqual(1);
        });

        it('caps at MEMORY_SCAN_MAX_FILES', () => {
            const dir = join(FAKE_HOME, 'scan-cap');
            mkdirSync(dir, { recursive: true });
            // Create more files than the cap
            for (let i = 0; i < _testing.MEMORY_SCAN_MAX_FILES + 10; i++) {
                writeFileSync(join(dir, `mem_${i}.md`), `content ${i}`);
            }
            const result = scanMemoryFiles(dir);
            expect(result.length).toBeLessThanOrEqual(_testing.MEMORY_SCAN_MAX_FILES);
        });
    });

    // ─── annotateIndexWithStaleness ───

    describe('annotateIndexWithStaleness', () => {
        it('returns unmodified index when no memory files exist', () => {
            const index = '- [Note](note.md) — some note';
            const result = annotateIndexWithStaleness(index, '/nonexistent');
            expect(result).toBe(index);
        });

        it('does not annotate fresh entries', () => {
            const dir = join(FAKE_HOME, 'annotate-fresh');
            mkdirSync(dir, { recursive: true });
            writeMemoryFile(dir, 'fresh.md', { body: 'fresh', ageDays: 0 });

            const index = '- [Fresh](fresh.md) — fresh note';
            const result = annotateIndexWithStaleness(index, dir);
            expect(result).toBe(index);
        });

        it('annotates stale entries (days)', () => {
            const dir = join(FAKE_HOME, 'annotate-stale-d');
            mkdirSync(dir, { recursive: true });
            writeMemoryFile(dir, 'stale.md', { body: 'stale', ageDays: 3 });

            const index = '- [Stale](stale.md) — old note';
            const result = annotateIndexWithStaleness(index, dir);
            expect(result).toContain('3d old');
            expect(result).toContain('verify');
        });

        it('annotates stale entries (weeks)', () => {
            const dir = join(FAKE_HOME, 'annotate-stale-w');
            mkdirSync(dir, { recursive: true });
            writeMemoryFile(dir, 'old.md', { body: 'old', ageDays: 14 });

            const index = '- [Old](old.md) — old note';
            const result = annotateIndexWithStaleness(index, dir);
            expect(result).toContain('2w old');
            expect(result).toContain('outdated');
        });

        it('annotates stale entries (months)', () => {
            const dir = join(FAKE_HOME, 'annotate-stale-m');
            mkdirSync(dir, { recursive: true });
            writeMemoryFile(dir, 'ancient.md', { body: 'ancient', ageDays: 60 });

            const index = '- [Ancient](ancient.md) — ancient note';
            const result = annotateIndexWithStaleness(index, dir);
            expect(result).toContain('2mo old');
            expect(result).toContain('stale');
        });

        it('handles mixed fresh and stale entries', () => {
            const dir = join(FAKE_HOME, 'annotate-mixed');
            mkdirSync(dir, { recursive: true });
            writeMemoryFile(dir, 'fresh.md', { body: 'f', ageDays: 0 });
            writeMemoryFile(dir, 'stale.md', { body: 's', ageDays: 5 });

            const index = '- [Fresh](fresh.md) — new\n- [Stale](stale.md) — old';
            const result = annotateIndexWithStaleness(index, dir);
            const lines = result.split('\n');
            // Fresh line should NOT have caveat
            expect(lines[0]).not.toContain('verify');
            expect(lines[0]).not.toContain('old');
            // Stale line SHOULD have caveat
            expect(lines[1]).toContain('5d old');
        });

        it('does not annotate lines without markdown links', () => {
            const dir = join(FAKE_HOME, 'annotate-nolink');
            mkdirSync(dir, { recursive: true });
            writeMemoryFile(dir, 'note.md', { body: 'n', ageDays: 30 });

            const index = '# Memory Index\nJust plain text\n- [Note](note.md) — a note';
            const result = annotateIndexWithStaleness(index, dir);
            const lines = result.split('\n');
            expect(lines[0]).toBe('# Memory Index');
            expect(lines[1]).toBe('Just plain text');
            expect(lines[2]).toContain('stale');
        });

        it('handles entries referencing non-existent files', () => {
            const dir = join(FAKE_HOME, 'annotate-missing');
            mkdirSync(dir, { recursive: true });

            const index = '- [Ghost](ghost.md) — does not exist on disk';
            const result = annotateIndexWithStaleness(index, dir);
            // Should be unmodified — no file to get age from
            expect(result).toBe(index);
        });
    });

    // ─── Project key isolation ───

    describe('projectKey', () => {
        it('generates different keys for different paths', () => {
            const key1 = _testing.projectKey('/home/user/project-a');
            const key2 = _testing.projectKey('/home/user/project-b');
            expect(key1).not.toBe(key2);
        });

        it('generates same key for same path', () => {
            const key1 = _testing.projectKey('/home/user/project');
            const key2 = _testing.projectKey('/home/user/project');
            expect(key1).toBe(key2);
        });

        it('includes basename in key for readability', () => {
            const key = _testing.projectKey('/home/user/my-project');
            expect(key).toContain('my-project');
        });

        it('sanitizes special characters in basename', () => {
            const key = _testing.projectKey('/home/user/my project @!#');
            expect(key).not.toContain(' ');
            expect(key).not.toContain('@');
            expect(key).not.toContain('!');
        });
    });

    // ─── Cache behavior edge cases ───

    describe('cache edge cases', () => {
        it('separate cache entries for different cwds', () => {
            const globalDir = join(FAKE_HOME, '.deepa', 'memory', 'global');
            mkdirSync(globalDir, { recursive: true });
            writeFileSync(join(globalDir, 'MEMORY.md'), 'shared global');

            const r1 = loadPrimaryMemoryIndex(CWD_A);
            const r2 = loadPrimaryMemoryIndex(CWD_B);
            // Both should contain the global part
            expect(r1).toContain('shared global');
            expect(r2).toContain('shared global');
            // But project parts should differ
            expect(r1).not.toBe(r2);
        });

        it('clearMemoryCache clears ALL cache entries', () => {
            const globalDir = join(FAKE_HOME, '.deepa', 'memory', 'global');
            mkdirSync(globalDir, { recursive: true });
            writeFileSync(join(globalDir, 'MEMORY.md'), 'v1');

            loadPrimaryMemoryIndex(CWD_A);
            loadPrimaryMemoryIndex(CWD_B);

            const agentDir = join(FAKE_HOME, '.deepa', 'memory', 'agents', 'TestBot');
            mkdirSync(agentDir, { recursive: true });
            writeFileSync(join(agentDir, 'MEMORY.md'), 'agent v1');
            loadSubagentMemory('TestBot');

            // Modify all
            writeFileSync(join(globalDir, 'MEMORY.md'), 'v2');
            writeFileSync(join(agentDir, 'MEMORY.md'), 'agent v2');

            clearMemoryCache();

            expect(loadPrimaryMemoryIndex(CWD_A)).toContain('v2');
            expect(loadPrimaryMemoryIndex(CWD_B)).toContain('v2');
            expect(loadSubagentMemory('TestBot')).toBe('agent v2');
        });
    });
});
