import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileReadTool } from '../../src/tools/file-read.js';
import { fileWriteTool } from '../../src/tools/file-write.js';
import { fileEditTool } from '../../src/tools/file-edit.js';
import { fileListTool } from '../../src/tools/file-list.js';
import type { ToolContext } from '../../src/types.js';

const TEST_DIR = join(tmpdir(), 'deepa-cli-test-' + Date.now());

function makeContext(): ToolContext {
    return {
        cwd: TEST_DIR,
        autonomy: 'auto',
        confirmAction: async () => true,
        log: () => { },
    };
}

describe('File Tools', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    // ─── file_read ───
    describe('file_read', () => {
        it('reads a full file', async () => {
            writeFileSync(join(TEST_DIR, 'hello.txt'), 'line1\nline2\nline3');
            const result = await fileReadTool.execute({ path: 'hello.txt' }, makeContext());
            expect(result.content).toContain('line1');
            expect(result.content).toContain('line3');
            expect(result.isError).toBeUndefined();
        });

        it('reads a line range', async () => {
            writeFileSync(join(TEST_DIR, 'hello.txt'), 'a\nb\nc\nd\ne');
            const result = await fileReadTool.execute(
                { path: 'hello.txt', startLine: 2, endLine: 4 },
                makeContext(),
            );
            expect(result.content).toContain('b');
            expect(result.content).toContain('d');
            expect(result.content).not.toContain('1: a');
        });

        it('returns error for missing file', async () => {
            const result = await fileReadTool.execute({ path: 'missing.txt' }, makeContext());
            expect(result.isError).toBe(true);
            expect(result.content).toContain('not found');
        });

        it('returns error for directory path', async () => {
            mkdirSync(join(TEST_DIR, 'subdir'));
            const result = await fileReadTool.execute({ path: 'subdir' }, makeContext());
            expect(result.isError).toBe(true);
            expect(result.content).toContain('directory');
        });
    });

    // ─── file_write ───
    describe('file_write', () => {
        it('creates a new file', async () => {
            const result = await fileWriteTool.execute(
                { path: 'new.txt', content: 'hello world' },
                makeContext(),
            );
            expect(result.content).toContain('Created');
            expect(readFileSync(join(TEST_DIR, 'new.txt'), 'utf-8')).toBe('hello world');
        });

        it('overwrites an existing file', async () => {
            writeFileSync(join(TEST_DIR, 'old.txt'), 'old content');
            const result = await fileWriteTool.execute(
                { path: 'old.txt', content: 'new content' },
                makeContext(),
            );
            expect(result.content).toContain('Updated');
            expect(readFileSync(join(TEST_DIR, 'old.txt'), 'utf-8')).toBe('new content');
        });

        it('creates parent directories', async () => {
            await fileWriteTool.execute(
                { path: 'deep/nested/file.txt', content: 'deep', createDirectories: true },
                makeContext(),
            );
            expect(existsSync(join(TEST_DIR, 'deep/nested/file.txt'))).toBe(true);
        });
    });

    // ─── file_edit ───
    describe('file_edit', () => {
        it('replaces first occurrence', async () => {
            writeFileSync(join(TEST_DIR, 'edit.txt'), 'foo bar foo');
            const result = await fileEditTool.execute(
                { path: 'edit.txt', search: 'foo', replace: 'baz' },
                makeContext(),
            );
            expect(result.content).toContain('replaced 1');
            expect(readFileSync(join(TEST_DIR, 'edit.txt'), 'utf-8')).toBe('baz bar foo');
        });

        it('replaces all occurrences with replaceAll', async () => {
            writeFileSync(join(TEST_DIR, 'edit.txt'), 'foo bar foo');
            const result = await fileEditTool.execute(
                { path: 'edit.txt', search: 'foo', replace: 'baz', replaceAll: true },
                makeContext(),
            );
            expect(result.content).toContain('replaced 2');
            expect(readFileSync(join(TEST_DIR, 'edit.txt'), 'utf-8')).toBe('baz bar baz');
        });

        it('returns error when search text not found', async () => {
            writeFileSync(join(TEST_DIR, 'edit.txt'), 'hello');
            const result = await fileEditTool.execute(
                { path: 'edit.txt', search: 'xyz', replace: 'abc' },
                makeContext(),
            );
            expect(result.isError).toBe(true);
            expect(result.content).toContain('not found');
        });
    });

    // ─── file_list ───
    describe('file_list', () => {
        it('lists directory contents', async () => {
            writeFileSync(join(TEST_DIR, 'a.txt'), 'a');
            writeFileSync(join(TEST_DIR, 'b.txt'), 'b');
            mkdirSync(join(TEST_DIR, 'subdir'));

            const result = await fileListTool.execute({ path: '.' }, makeContext());
            expect(result.content).toContain('a.txt');
            expect(result.content).toContain('b.txt');
            expect(result.content).toContain('subdir');
        });

        it('ignores node_modules', async () => {
            mkdirSync(join(TEST_DIR, 'node_modules'));
            writeFileSync(join(TEST_DIR, 'node_modules/pkg.js'), 'x');
            writeFileSync(join(TEST_DIR, 'index.js'), 'y');

            const result = await fileListTool.execute({ path: '.' }, makeContext());
            expect(result.content).toContain('index.js');
            expect(result.content).not.toContain('node_modules');
        });

        it('returns error for missing directory', async () => {
            const result = await fileListTool.execute({ path: 'nonexistent' }, makeContext());
            expect(result.isError).toBe(true);
        });
    });
});
