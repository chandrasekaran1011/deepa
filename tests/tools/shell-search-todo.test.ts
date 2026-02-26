import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { shellTool } from '../../src/tools/shell.js';
import { searchGrepTool } from '../../src/tools/search-grep.js';
import { todoTool, getTodos, resetTodos, formatTodos } from '../../src/tools/todo.js';
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

    // ─── Inline script auto-conversion (exhaustive) ───
    // Every inline pattern an LLM might generate MUST be caught and converted.

    // 1. node -e with single quotes
    it('catches: node -e \'console.log("x")\'', async () => {
        const result = await shellTool.execute(
            { command: `node -e 'console.log("flag-single")'` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('flag-single');
        expect(result.content).toContain('Exit code: 0');
    });

    // 2. node -e with double quotes
    it('catches: node -e "console.log(\'x\')"', async () => {
        const result = await shellTool.execute(
            { command: `node -e "console.log('flag-double')"` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('flag-double');
    });

    // 3. node --eval (long flag)
    it('catches: node --eval \'...\'', async () => {
        const result = await shellTool.execute(
            { command: `node --eval 'console.log("eval-long")'` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('eval-long');
    });

    // 4. python3 -c
    it('catches: python3 -c \'print("x")\'', async () => {
        const result = await shellTool.execute(
            { command: `python3 -c 'print("py3-flag")'` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('py3-flag');
    });

    // 5. python -c (without the 3)
    it('catches: python -c \'print("x")\' and normalizes to python3', async () => {
        const result = await shellTool.execute(
            { command: `python -c 'print("py-no3")'` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('py-no3');
    });

    // 6. Heredoc with dash: python3 - <<'PY'
    it('catches: python3 - <<\'PY\'\\n...\\nPY', async () => {
        const result = await shellTool.execute(
            { command: `python3 - <<'PY'\nprint("heredoc-dash")\nPY` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('heredoc-dash');
    });

    // 7. Heredoc without dash: python3 <<'PY'
    it('catches: python3 <<\'PY\'\\n...\\nPY', async () => {
        const result = await shellTool.execute(
            { command: `python3 <<'PY'\nprint("heredoc-nodash")\nPY` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('heredoc-nodash');
    });

    // 8. Heredoc with node
    it('catches: node - <<\'JS\'\\n...\\nJS', async () => {
        const result = await shellTool.execute(
            { command: `node - <<'JS'\nconsole.log("node-heredoc")\nJS` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('node-heredoc');
    });

    // 9. Heredoc with EOF delimiter (common LLM choice)
    it('catches: python3 - <<\'EOF\'\\n...\\nEOF', async () => {
        const result = await shellTool.execute(
            { command: `python3 - <<'EOF'\nprint("eof-delim")\nEOF` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('eof-delim');
    });

    // 10. Heredoc without quotes on delimiter
    it('catches: node - <<JS\\n...\\nJS (unquoted delimiter)', async () => {
        const result = await shellTool.execute(
            { command: `node - <<JS\nconsole.log("unquoted-delim")\nJS` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('unquoted-delim');
    });

    // 11. Echo pipe into node
    it('catches: echo \'...\' | node', async () => {
        const result = await shellTool.execute(
            { command: `echo 'console.log("echo-pipe")' | node` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('echo-pipe');
    });

    // 12. Echo pipe into python3
    it('catches: echo \'...\' | python3', async () => {
        const result = await shellTool.execute(
            { command: `echo 'print("echo-py")' | python3` },
            makeContext(),
        );
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('echo-py');
    });

    // 13. Multi-line heredoc (the real-world pattern from user's report)
    it('catches: multi-line python heredoc with imports', async () => {
        const cmd = `python3 - <<'PY'\nimport os\nprint("multi-line")\nprint(os.getcwd())\nPY`;
        const result = await shellTool.execute({ command: cmd }, makeContext());
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('multi-line');
    });

    // 14. Multi-line node heredoc
    it('catches: multi-line node heredoc', async () => {
        const cmd = `node - <<'JS'\nconst x = 42;\nconsole.log("val=" + x);\nJS`;
        const result = await shellTool.execute({ command: cmd }, makeContext());
        expect(result.content).toContain('auto-converted inline script');
        expect(result.content).toContain('val=42');
    });

    // 15. Temp file is always cleaned up after execution
    it('cleans up temp file after every execution', async () => {
        await shellTool.execute(
            { command: `node -e 'console.log("cleanup-test")'` },
            makeContext(),
        );
        const tmpDir = join(TEST_DIR, '.deepa', 'tmp');
        if (existsSync(tmpDir)) {
            const files = readdirSync(tmpDir);
            expect(files.filter(f => f.startsWith('_inline_'))).toHaveLength(0);
        }
    });

    // ─── Negative cases: these must NOT be converted ───

    it('does NOT convert: echo hello', async () => {
        const result = await shellTool.execute({ command: 'echo hello' }, makeContext());
        expect(result.content).not.toContain('auto-converted');
        expect(result.content).toContain('hello');
    });

    it('does NOT convert: node test.js (running a file)', async () => {
        writeFileSync(join(TEST_DIR, 'test.js'), 'console.log("file-script")');
        const result = await shellTool.execute({ command: 'node test.js' }, makeContext());
        expect(result.content).not.toContain('auto-converted');
        expect(result.content).toContain('file-script');
    });

    it('does NOT convert: npm install', async () => {
        const result = await shellTool.execute({ command: 'echo npm-install-sim' }, makeContext());
        expect(result.content).not.toContain('auto-converted');
    });

    it('does NOT convert: git status', async () => {
        const result = await shellTool.execute({ command: 'echo git-status-sim' }, makeContext());
        expect(result.content).not.toContain('auto-converted');
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
        resetTodos();
    });

    // ─── Full-list replacement ───

    it('writes a complete todo list', async () => {
        const result = await todoTool.execute({
            todos: [
                { content: 'Task A', status: 'pending' },
                { content: 'Task B', status: 'in_progress' },
                { content: 'Task C', status: 'pending' },
            ],
        }, makeContext());
        expect(result.isError).toBeUndefined();
        expect(result.content).toContain('Task A');
        expect(result.content).toContain('Task B');
        expect(result.content).toContain('Task C');
        expect(result.content).toContain('0/3');
    });

    it('replaces the previous list entirely', async () => {
        await todoTool.execute({
            todos: [
                { content: 'Old task', status: 'pending' },
            ],
        }, makeContext());
        const result = await todoTool.execute({
            todos: [
                { content: 'New task', status: 'in_progress' },
            ],
        }, makeContext());
        expect(result.content).toContain('New task');
        expect(result.content).not.toContain('Old task');
        expect(getTodos()).toHaveLength(1);
        expect(getTodos()[0].content).toBe('New task');
    });

    // ─── Status tracking ───

    it('tracks completed count correctly', async () => {
        const result = await todoTool.execute({
            todos: [
                { content: 'Done 1', status: 'completed' },
                { content: 'Done 2', status: 'completed' },
                { content: 'Working', status: 'in_progress' },
                { content: 'Later', status: 'pending' },
            ],
        }, makeContext());
        expect(result.content).toContain('2/4');
        expect(result.content).toContain('50%');
    });

    it('shows 100% when all completed', async () => {
        const result = await todoTool.execute({
            todos: [
                { content: 'Done A', status: 'completed' },
                { content: 'Done B', status: 'completed' },
            ],
        }, makeContext());
        expect(result.content).toContain('2/2');
        expect(result.content).toContain('100%');
    });

    // ─── Validation ───

    it('rejects multiple in_progress tasks', async () => {
        const result = await todoTool.execute({
            todos: [
                { content: 'Task 1', status: 'in_progress' },
                { content: 'Task 2', status: 'in_progress' },
            ],
        }, makeContext());
        expect(result.isError).toBe(true);
        expect(result.content).toContain('Only one task can be in_progress');
    });

    it('allows exactly one in_progress task', async () => {
        const result = await todoTool.execute({
            todos: [
                { content: 'Task 1', status: 'completed' },
                { content: 'Task 2', status: 'in_progress' },
                { content: 'Task 3', status: 'pending' },
            ],
        }, makeContext());
        expect(result.isError).toBeUndefined();
    });

    it('allows zero in_progress tasks', async () => {
        const result = await todoTool.execute({
            todos: [
                { content: 'Task 1', status: 'pending' },
                { content: 'Task 2', status: 'pending' },
            ],
        }, makeContext());
        expect(result.isError).toBeUndefined();
    });

    // ─── In-memory store ───

    it('stores todos in memory (getTodos)', async () => {
        expect(getTodos()).toHaveLength(0);
        await todoTool.execute({
            todos: [
                { content: 'A', status: 'pending' },
                { content: 'B', status: 'completed' },
            ],
        }, makeContext());
        const stored = getTodos();
        expect(stored).toHaveLength(2);
        expect(stored[0]).toEqual({ content: 'A', status: 'pending' });
        expect(stored[1]).toEqual({ content: 'B', status: 'completed' });
    });

    it('resets with resetTodos()', async () => {
        await todoTool.execute({
            todos: [{ content: 'X', status: 'pending' }],
        }, makeContext());
        expect(getTodos()).toHaveLength(1);
        resetTodos();
        expect(getTodos()).toHaveLength(0);
    });

    // ─── Handles many tasks (no 5-item limit) ───

    it('handles 20+ tasks without truncation', async () => {
        const tasks = Array.from({ length: 25 }, (_, i) => ({
            content: `Task ${i + 1}`,
            status: i < 10 ? 'completed' as const : i === 10 ? 'in_progress' as const : 'pending' as const,
        }));
        const result = await todoTool.execute({ todos: tasks }, makeContext());
        expect(result.isError).toBeUndefined();
        expect(result.content).toContain('Task 1');
        expect(result.content).toContain('Task 25');
        expect(result.content).toContain('10/25');
        expect(getTodos()).toHaveLength(25);
    });

    // ─── formatTodos output ───

    it('formatTodos shows status icons', () => {
        const output = formatTodos([
            { content: 'Done task', status: 'completed' },
            { content: 'Active task', status: 'in_progress' },
            { content: 'Later task', status: 'pending' },
        ]);
        expect(output).toContain('✓');         // completed icon
        expect(output).toContain('▸');         // in_progress icon
        expect(output).toContain('○');         // pending icon
        expect(output).toContain('Done task');
        expect(output).toContain('Active task');
        expect(output).toContain('Later task');
        expect(output).toContain('1/3');
        expect(output).toContain('33%');
    });

    it('formatTodos handles empty list', () => {
        expect(formatTodos([])).toBe('No tasks.');
    });

    it('has safe safety level', () => {
        expect(todoTool.safetyLevel).toBe('safe');
    });
});
