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

        it('shows old vs new line count on overwrite', async () => {
            writeFileSync(join(TEST_DIR, 'old.txt'), 'a\nb\nc');
            const result = await fileWriteTool.execute(
                { path: 'old.txt', content: 'x\ny\nz\nw\nv' },
                makeContext(),
            );
            expect(result.content).toContain('was 3 lines');
            expect(result.content).toContain('now 5 lines');
        });

        it('blocks binary formats (.pptx, .png, .zip, etc.)', async () => {
            const blocked = ['.pptx', '.xlsx', '.pdf', '.docx', '.png', '.jpg', '.mp3', '.zip', '.exe', '.woff'];
            for (const ext of blocked) {
                const result = await fileWriteTool.execute(
                    { path: `test${ext}`, content: 'data' },
                    makeContext(),
                );
                expect(result.isError).toBe(true);
                expect(result.content).toContain('Cannot write binary');
                expect(existsSync(join(TEST_DIR, `test${ext}`))).toBe(false);
            }
        });

        // ─── Append / chunked writes ───

        it('appends to an existing file', async () => {
            writeFileSync(join(TEST_DIR, 'chunk.txt'), 'line1\nline2\n');
            const result = await fileWriteTool.execute(
                { path: 'chunk.txt', content: 'line3\nline4\n', append: true },
                makeContext(),
            );
            expect(result.isError).toBeUndefined();
            expect(result.content).toContain('Appended');
            expect(result.content).toContain('total now 5 lines');
            expect(readFileSync(join(TEST_DIR, 'chunk.txt'), 'utf-8')).toBe('line1\nline2\nline3\nline4\n');
        });

        it('errors when appending to nonexistent file', async () => {
            const result = await fileWriteTool.execute(
                { path: 'missing.txt', content: 'chunk', append: true },
                makeContext(),
            );
            expect(result.isError).toBe(true);
            expect(result.content).toContain('does not exist');
        });

        it('supports multi-chunk write workflow', async () => {
            // Chunk 1: create file
            await fileWriteTool.execute(
                { path: 'big.ts', content: 'const a = 1;\n' },
                makeContext(),
            );
            // Chunk 2: append
            await fileWriteTool.execute(
                { path: 'big.ts', content: 'const b = 2;\n', append: true },
                makeContext(),
            );
            // Chunk 3: append
            const result = await fileWriteTool.execute(
                { path: 'big.ts', content: 'export { a, b };\n', append: true },
                makeContext(),
            );
            expect(result.content).toContain('total now 4 lines');
            expect(readFileSync(join(TEST_DIR, 'big.ts'), 'utf-8')).toBe(
                'const a = 1;\nconst b = 2;\nexport { a, b };\n',
            );
        });

        it('allows text/source code files', async () => {
            const allowed = ['.txt', '.md', '.ts', '.js', '.py', '.json', '.html', '.css', '.yaml', '.mjs'];
            for (const ext of allowed) {
                const result = await fileWriteTool.execute(
                    { path: `test${ext}`, content: 'content' },
                    makeContext(),
                );
                expect(result.isError).toBeUndefined();
                expect(result.content).toContain('Created');
            }
        });
    });

    // ─── file_edit ───
    describe('file_edit', () => {
        it('replaces unique occurrence', async () => {
            writeFileSync(join(TEST_DIR, 'edit.txt'), 'foo bar baz');
            const result = await fileEditTool.execute(
                { path: 'edit.txt', search: 'bar', replace: 'qux' },
                makeContext(),
            );
            expect(result.content).toContain('replaced 1');
            expect(readFileSync(join(TEST_DIR, 'edit.txt'), 'utf-8')).toBe('foo qux baz');
        });

        it('rejects ambiguous match when replaceAll is false', async () => {
            writeFileSync(join(TEST_DIR, 'edit.txt'), 'foo bar foo');
            const result = await fileEditTool.execute(
                { path: 'edit.txt', search: 'foo', replace: 'baz' },
                makeContext(),
            );
            expect(result.isError).toBe(true);
            expect(result.content).toContain('2 occurrences');
            expect(result.content).toContain('unique');
            // File must NOT be modified
            expect(readFileSync(join(TEST_DIR, 'edit.txt'), 'utf-8')).toBe('foo bar foo');
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

        it('shows context around the edit', async () => {
            writeFileSync(join(TEST_DIR, 'ctx.txt'), 'line1\nline2\nline3\nline4\nline5');
            const result = await fileEditTool.execute(
                { path: 'ctx.txt', search: 'line3', replace: 'CHANGED' },
                makeContext(),
            );
            expect(result.isError).toBeUndefined();
            expect(result.content).toContain('Context after edit');
            expect(result.content).toContain('CHANGED');
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

        it('returns error for missing file', async () => {
            const result = await fileEditTool.execute(
                { path: 'nope.txt', search: 'x', replace: 'y' },
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
