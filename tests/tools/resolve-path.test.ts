// ─── Path resolution & security sandbox tests ───

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir, homedir } from 'os';
import { resolvePath } from '../../src/tools/resolve-path.js';

// Create a fake workspace with a .git dir so sandbox detection works
const WORKSPACE = join(tmpdir(), `deepa-sandbox-test-${Date.now()}`);

describe('resolvePath', () => {
    beforeEach(() => {
        mkdirSync(join(WORKSPACE, '.git'), { recursive: true });
        mkdirSync(join(WORKSPACE, 'src'), { recursive: true });
        writeFileSync(join(WORKSPACE, 'src', 'index.ts'), '');
    });

    afterEach(() => {
        rmSync(WORKSPACE, { recursive: true, force: true });
    });

    describe('Relative paths', () => {
        it('resolves a relative path against cwd', () => {
            const result = resolvePath('src/index.ts', WORKSPACE);
            expect(result).toBe(join(WORKSPACE, 'src', 'index.ts'));
        });

        it('resolves dot-relative path', () => {
            const result = resolvePath('./src/index.ts', WORKSPACE);
            expect(result).toBe(join(WORKSPACE, 'src', 'index.ts'));
        });

        it('resolves current directory "."', () => {
            const result = resolvePath('.', WORKSPACE);
            expect(result).toBe(WORKSPACE);
        });
    });

    describe('Absolute paths', () => {
        it('returns absolute paths within workspace as-is', () => {
            const abs = join(WORKSPACE, 'src', 'index.ts');
            const result = resolvePath(abs, WORKSPACE);
            expect(result).toBe(abs);
        });

        it('throws when absolute path escapes workspace', () => {
            const outside = '/etc/passwd';
            expect(() => resolvePath(outside, WORKSPACE)).toThrow(/Security Sandbox/);
        });

        it('throws on path traversal outside workspace', () => {
            expect(() => resolvePath('../../../etc/passwd', WORKSPACE)).toThrow(/Security Sandbox/);
        });
    });

    describe('Home directory expansion', () => {
        it('expands ~ to home directory', () => {
            const result = resolvePath('~', WORKSPACE);
            expect(result).toBe(homedir());
        });

        it('expands ~/path correctly', () => {
            const result = resolvePath('~/Documents/foo.txt', WORKSPACE);
            expect(result).toBe(join(homedir(), 'Documents', 'foo.txt'));
        });
    });

    describe('~/.deepa config directory allowance', () => {
        it('allows access to ~/.deepa directory without sandbox restriction', () => {
            const deepaPath = join(homedir(), '.deepa', 'models.json');
            // Should not throw even though it's outside the workspace
            expect(() => resolvePath(deepaPath, WORKSPACE)).not.toThrow();
            const result = resolvePath(deepaPath, WORKSPACE);
            expect(result).toBe(deepaPath);
        });
    });

    describe('Security edge cases', () => {
        it('blocks double-dot traversal that looks safe but escapes', () => {
            expect(() =>
                resolvePath('src/../../../../../../etc/hosts', WORKSPACE),
            ).toThrow(/Security Sandbox/);
        });

        it('allows sibling .worktrees directory', () => {
            // Create a sibling .worktrees dir
            const worktreesDir = join(WORKSPACE, '..', '.worktrees', 'feature-branch');
            mkdirSync(worktreesDir, { recursive: true });
            // Should not throw
            expect(() => resolvePath(worktreesDir, WORKSPACE)).not.toThrow();
            rmSync(join(WORKSPACE, '..', '.worktrees'), { recursive: true, force: true });
        });
    });
});
