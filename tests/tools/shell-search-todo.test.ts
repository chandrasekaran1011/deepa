import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { shellTool } from '../../src/tools/shell.js';
import { searchGrepTool } from '../../src/tools/search-grep.js';
import { todoTool } from '../../src/tools/todo.js';
import type { ToolContext } from '../../src/types.js';

const TEST_DIR = join(tmpdir(), 'deepa-cli-test-shell-' + Date.now());

function makeContext(): ToolContext {
    return {
        cwd: TEST_DIR,
        autonomy: 'auto',
        confirmAction: async () => true,
        log: () => { },
    };
}

describe('Shell Tool', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('executes a simple command', async () => {
        const result = await shellTool.execute({ command: 'echo hello' }, makeContext());
        expect(result.content).toContain('hello');
        expect(result.content).toContain('Exit code: 0');
    });

    it('captures stderr', async () => {
        const result = await shellTool.execute({ command: 'echo error >&2' }, makeContext());
        expect(result.content).toContain('error');
    });

    it('reports non-zero exit code', async () => {
        const result = await shellTool.execute({ command: 'exit 1' }, makeContext());
        expect(result.isError).toBe(true);
        expect(result.content).toContain('Exit code: 1');
    });

    it('respects cwd parameter', async () => {
        const result = await shellTool.execute({ command: 'pwd' }, makeContext());
        expect(result.content).toContain(TEST_DIR);
    });

    it('has dangerous safety level', () => {
        expect(shellTool.safetyLevel).toBe('dangerous');
    });
});

describe('Search Grep Tool', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(join(TEST_DIR, 'code.ts'), `function hello() {\n  console.log("hello world");\n}\n`);
        writeFileSync(join(TEST_DIR, 'readme.md'), '# Hello\n\nThis is a test.\n');
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('finds text matches', async () => {
        const result = await searchGrepTool.execute({ query: 'hello', path: '.' }, makeContext());
        expect(result.content).toContain('hello');
        expect(result.content).not.toContain('No matches');
    });

    it('returns no matches message', async () => {
        const result = await searchGrepTool.execute({ query: 'xyz_nonexistent', path: '.' }, makeContext());
        expect(result.content).toContain('No matches');
    });
});

describe('Todo Tool', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('returns message when no plan exists', async () => {
        const result = await todoTool.execute({ action: 'read' }, makeContext());
        expect(result.content).toContain('No plan exists');
    });

    it('writes and reads a plan', async () => {
        await todoTool.execute(
            { action: 'write', content: '- [ ] Task 1\n- [ ] Task 2' },
            makeContext(),
        );
        const result = await todoTool.execute({ action: 'read' }, makeContext());
        expect(result.content).toContain('Task 1');
        expect(result.content).toContain('Task 2');
    });

    it('toggles a task', async () => {
        await todoTool.execute(
            { action: 'write', content: '- [ ] First\n- [ ] Second' },
            makeContext(),
        );
        const result = await todoTool.execute({ action: 'toggle', taskIndex: 0 }, makeContext());
        expect(result.content).toContain('[x]');
    });
});
