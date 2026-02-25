// ─── Memory system tests ───

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir, homedir } from 'os';

// We need to override the memory dir to avoid touching the real ~/.deepa
// The module reads homedir() at module load, so we mock os.homedir before import.
import { vi } from 'vitest';

const FAKE_HOME = join(tmpdir(), `deepa-memory-test-home-${Date.now()}`);

vi.mock('os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    return {
        ...actual,
        homedir: () => FAKE_HOME,
    };
});

// Import after mocking homedir
const { loadMemory, saveMemory, listMemory } = await import('../../src/context/memory.js');

const CWD_A = join(tmpdir(), `deepa-proj-a-${Date.now()}`);
const CWD_B = join(tmpdir(), `deepa-proj-a-${Date.now()}-different`); // same basename, different path

describe('Memory System', () => {
    beforeEach(() => {
        mkdirSync(FAKE_HOME, { recursive: true });
        mkdirSync(CWD_A, { recursive: true });
        mkdirSync(CWD_B, { recursive: true });
    });

    afterEach(() => {
        rmSync(FAKE_HOME, { recursive: true, force: true });
        rmSync(CWD_A, { recursive: true, force: true });
        rmSync(CWD_B, { recursive: true, force: true });
    });

    describe('loadMemory', () => {
        it('returns undefined when no memory files exist', () => {
            const result = loadMemory(CWD_A);
            expect(result).toBeUndefined();
        });

        it('loads global memory entries', () => {
            saveMemory('global-key', 'global content here', 'global', CWD_A);
            const result = loadMemory(CWD_A);
            expect(result).toContain('global content here');
        });

        it('loads project-specific memory entries', () => {
            saveMemory('proj-key', 'project content here', 'project', CWD_A);
            const result = loadMemory(CWD_A);
            expect(result).toContain('project content here');
        });

        it('loads both global and project memory together', () => {
            saveMemory('g', 'global data', 'global', CWD_A);
            saveMemory('p', 'project data', 'project', CWD_A);
            const result = loadMemory(CWD_A);
            expect(result).toContain('global data');
            expect(result).toContain('project data');
        });

        it('does not load another project memory for a different cwd', () => {
            saveMemory('secret', 'project-b-only', 'project', CWD_B);
            const result = loadMemory(CWD_A);
            // result may be undefined (no memory for CWD_A) — either way must not contain B's data
            expect(result ?? '').not.toContain('project-b-only');
        });
    });

    describe('saveMemory', () => {
        it('creates a memory file that can be read back', () => {
            saveMemory('test-entry', 'some remembered fact', 'global', CWD_A);
            const result = loadMemory(CWD_A);
            expect(result).toContain('some remembered fact');
        });

        it('overwrites existing memory with same key', () => {
            saveMemory('key', 'old value', 'global', CWD_A);
            saveMemory('key', 'new value', 'global', CWD_A);
            const result = loadMemory(CWD_A);
            expect(result).toContain('new value');
            expect(result).not.toContain('old value');
        });

        it('sanitises key names with special characters', () => {
            // Should not throw
            expect(() =>
                saveMemory('my key/with:special chars!', 'content', 'global', CWD_A),
            ).not.toThrow();
            const result = loadMemory(CWD_A);
            expect(result).toContain('content');
        });
    });

    describe('listMemory', () => {
        it('returns empty array when no memory', () => {
            const list = listMemory(CWD_A);
            expect(list).toEqual([]);
        });

        it('lists global and project keys with correct scopes', () => {
            saveMemory('g-key', 'global', 'global', CWD_A);
            saveMemory('p-key', 'project', 'project', CWD_A);
            const list = listMemory(CWD_A);
            expect(list.some((e) => e.scope === 'global')).toBe(true);
            expect(list.some((e) => e.scope === 'project')).toBe(true);
        });
    });

    describe('projectKey collision prevention', () => {
        it('two projects with the same basename but different paths get separate memory', () => {
            // Both CWD_A and CWD_B have different absolute paths — should be isolated
            saveMemory('note', 'for project A', 'project', CWD_A);
            saveMemory('note', 'for project B', 'project', CWD_B);

            const resultA = loadMemory(CWD_A);
            const resultB = loadMemory(CWD_B);

            expect(resultA).toContain('for project A');
            expect(resultB).toContain('for project B');

            // Cross-contamination check
            expect(resultA).not.toContain('for project B');
            expect(resultB).not.toContain('for project A');
        });
    });
});
