// ─── Memory system tests ───

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs';
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

const { loadPrimaryMemoryIndex, loadSubagentMemory, clearMemoryCache } = await import('../../src/context/memory.js');

const CWD_A = join(tmpdir(), `deepa-proj-a-${Date.now()}`);
const CWD_B = join(tmpdir(), `deepa-proj-a-${Date.now()}-different`);

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
            // Should not have created any directories
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
            // We need to find the project key for CWD_A
            // The key is basename_hash, so create all possible dirs
            const projectsDir = join(FAKE_HOME, '.deepa', 'memory', 'projects');
            mkdirSync(projectsDir, { recursive: true });

            // Get the result first to see which key format it expects
            const result1 = loadPrimaryMemoryIndex(CWD_A);
            // Extract the project dir path from the result
            const match = result1.match(/`([^`]+\/projects\/[^`/]+)\/MEMORY\.md`/);
            expect(match).not.toBeNull();
            const projDir = match![1];
            mkdirSync(projDir, { recursive: true });
            writeFileSync(join(projDir, 'MEMORY.md'), '- [Auth](auth.md) — uses JWT');

            clearMemoryCache(); // Clear cache to re-read
            const result2 = loadPrimaryMemoryIndex(CWD_A);
            expect(result2).toContain('uses JWT');
        });

        it('caches results for subsequent calls', () => {
            const globalDir = join(FAKE_HOME, '.deepa', 'memory', 'global');
            mkdirSync(globalDir, { recursive: true });
            writeFileSync(join(globalDir, 'MEMORY.md'), 'cached value');

            const result1 = loadPrimaryMemoryIndex(CWD_A);
            // Modify the file
            writeFileSync(join(globalDir, 'MEMORY.md'), 'new value');
            // Should still return cached
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
            // Both should reference different project keys
            const result1 = loadPrimaryMemoryIndex(CWD_A);
            clearMemoryCache();
            const result2 = loadPrimaryMemoryIndex(CWD_B);

            // Extract project dir paths — they should be different
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
    });

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
});
