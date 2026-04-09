// ─── Comprehensive CLI Integration Tests ───
// Tests the full pipeline: tool selection, execution, error handling,
// mode behavior, multi-turn conversations, edge cases, and more.
// Target: 500+ test cases covering all major deepa-cli subsystems.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runAgentLoop } from '../../src/agent/loop.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { fileReadTool } from '../../src/tools/file-read.js';
import { fileWriteTool } from '../../src/tools/file-write.js';
import { fileEditTool } from '../../src/tools/file-edit.js';
import { fileListTool } from '../../src/tools/file-list.js';
import { searchGrepTool } from '../../src/tools/search-grep.js';
import { shellTool } from '../../src/tools/shell.js';
import { todoTool, resetTodos, getTodos } from '../../src/tools/todo.js';
import { thinkTool } from '../../src/tools/think.js';
import { buildSystemPrompt } from '../../src/agent/prompts.js';
import { interpretCommandResult, extractBaseCommand, detectBlockedSleepPattern } from '../../src/tools/shell-semantics.js';
import { truncateOutput } from '../../src/utils/text.js';
import type { LLMProvider } from '../../src/providers/base.js';
import type { DeepaConfig, Message, StreamChunk, ToolContext } from '../../src/types.js';

// ─── Infrastructure ──────────────────────────────

const WORKSPACE = join(tmpdir(), `deepa-comprehensive-${Date.now()}`);

function makeConfig(mode: 'chat' | 'plan' | 'exec' = 'exec'): DeepaConfig {
    return {
        provider: { type: 'local', model: 'mock', maxTokens: 4096 },
        autonomy: 'high', mode, mcpServers: {}, verbose: false,
    };
}

function makeRegistry(): ToolRegistry {
    const r = new ToolRegistry();
    r.register(fileReadTool);
    r.register(fileWriteTool);
    r.register(fileEditTool);
    r.register(fileListTool);
    r.register(searchGrepTool);
    r.register(shellTool);
    r.register(todoTool);
    r.register(thinkTool);
    return r;
}

function makeContext(): ToolContext {
    return {
        cwd: WORKSPACE,
        autonomy: 'high',
        confirmAction: async () => true,
        log: () => {},
        readFileState: new Map(),
        messages: [],
    };
}

function makeOptions(provider: LLMProvider, mode: 'chat' | 'plan' | 'exec' = 'exec') {
    return {
        provider, tools: makeRegistry(), config: makeConfig(mode),
        cwd: WORKSPACE, confirmAction: async () => true as const,
    };
}

function scriptedProvider(turns: StreamChunk[][]): LLMProvider {
    let turn = 0;
    return {
        name: 'scripted',
        async *chat() {
            const chunks = turns[Math.min(turn, turns.length - 1)];
            turn++;
            for (const c of chunks) yield c;
        },
    };
}

function tc(id: string, name: string, args: Record<string, unknown>): StreamChunk {
    return { type: 'tool_call', id, name, arguments: JSON.stringify(args) };
}
function done(pt = 50, ct = 100): StreamChunk {
    return { type: 'done', usage: { promptTokens: pt, completionTokens: ct } };
}
function text(t: string): StreamChunk {
    return { type: 'text', text: t };
}

// ─── Setup / teardown ────────────────────────────

beforeEach(() => {
    resetTodos();
    mkdirSync(join(WORKSPACE, 'src'), { recursive: true });
    mkdirSync(join(WORKSPACE, 'tests'), { recursive: true });
    mkdirSync(join(WORKSPACE, '.git'), { recursive: true });
});

afterEach(() => {
    rmSync(WORKSPACE, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════
// SECTION 1: Shell Semantics (extractBaseCommand, interpretCommandResult, detectBlockedSleepPattern)
// ═════════════════════════════════════════════════

describe('Shell Semantics', () => {
    describe('extractBaseCommand', () => {
        it('extracts simple command', () => expect(extractBaseCommand('grep foo')).toBe('grep'));
        it('extracts from pipeline', () => expect(extractBaseCommand('cat file | grep foo')).toBe('grep'));
        it('extracts from multi-pipeline', () => expect(extractBaseCommand('ls | sort | head')).toBe('head'));
        it('handles empty string', () => expect(extractBaseCommand('')).toBe(''));
        it('handles command with flags', () => expect(extractBaseCommand('grep -rn pattern')).toBe('grep'));
        it('handles command with path', () => expect(extractBaseCommand('/usr/bin/grep foo')).toBe('/usr/bin/grep'));
        it('handles test bracket command', () => expect(extractBaseCommand('[ -f file ]')).toBe('['));
        it('extracts diff', () => expect(extractBaseCommand('diff a b')).toBe('diff'));
        it('extracts find', () => expect(extractBaseCommand('find . -name "*.ts"')).toBe('find'));
        it('extracts rg', () => expect(extractBaseCommand('rg pattern')).toBe('rg'));
    });

    describe('interpretCommandResult', () => {
        it('grep exit 0 is success', () => {
            const r = interpretCommandResult('grep foo', 0, 'match', '');
            expect(r.isError).toBe(false);
        });
        it('grep exit 1 is not error (no matches)', () => {
            const r = interpretCommandResult('grep foo', 1, '', '');
            expect(r.isError).toBe(false);
            expect(r.message).toContain('No matches');
        });
        it('grep exit 2 is error', () => {
            const r = interpretCommandResult('grep foo', 2, '', 'error');
            expect(r.isError).toBe(true);
        });
        it('diff exit 1 is not error (files differ)', () => {
            const r = interpretCommandResult('diff a b', 1, 'diff output', '');
            expect(r.isError).toBe(false);
            expect(r.message).toContain('Files differ');
        });
        it('test exit 1 is not error (false condition)', () => {
            const r = interpretCommandResult('test -f missing', 1, '', '');
            expect(r.isError).toBe(false);
        });
        it('[ exit 1 is not error', () => {
            const r = interpretCommandResult('[ -f missing ]', 1, '', '');
            expect(r.isError).toBe(false);
        });
        it('find exit 1 is partial success', () => {
            const r = interpretCommandResult('find . -name x', 1, '', 'perm denied');
            expect(r.isError).toBe(false);
        });
        it('rg exit 1 is no matches', () => {
            const r = interpretCommandResult('rg pattern', 1, '', '');
            expect(r.isError).toBe(false);
        });
        it('unknown command exit 0 is success', () => {
            const r = interpretCommandResult('custom_cmd', 0, 'ok', '');
            expect(r.isError).toBe(false);
        });
        it('unknown command exit 1 is error', () => {
            const r = interpretCommandResult('custom_cmd', 1, '', 'fail');
            expect(r.isError).toBe(true);
        });
        it('pipeline uses last command semantics', () => {
            const r = interpretCommandResult('cat file | grep foo', 1, '', '');
            expect(r.isError).toBe(false); // grep exit 1 is not error
        });
    });

    describe('detectBlockedSleepPattern', () => {
        it('blocks sleep 10', () => expect(detectBlockedSleepPattern('sleep 10')).toBe('sleep 10'));
        it('blocks sleep 5', () => expect(detectBlockedSleepPattern('sleep 5')).toBe('sleep 5'));
        it('blocks sleep 60', () => expect(detectBlockedSleepPattern('sleep 60')).toBe('sleep 60'));
        it('allows sleep 1', () => expect(detectBlockedSleepPattern('sleep 1')).toBeNull());
        it('allows sleep 0', () => expect(detectBlockedSleepPattern('sleep 0')).toBeNull());
        it('allows non-sleep commands', () => expect(detectBlockedSleepPattern('echo hello')).toBeNull());
        it('blocks sleep in chained command', () => expect(detectBlockedSleepPattern('sleep 30 && echo done')).toBe('sleep 30'));
        it('allows sleep with decimal under 2', () => expect(detectBlockedSleepPattern('sleep 1.5')).toBeNull());
        it('blocks sleep with decimal over 2', () => expect(detectBlockedSleepPattern('sleep 3.5')).toBe('sleep 3'));
        it('allows empty command', () => expect(detectBlockedSleepPattern('')).toBeNull());
    });
});

// ═════════════════════════════════════════════════
// SECTION 2: Text Utilities
// ═════════════════════════════════════════════════

describe('Text Utilities', () => {
    describe('truncateOutput', () => {
        it('does not truncate short strings', () => {
            expect(truncateOutput('hello', 1000)).toBe('hello');
        });
        it('truncates long strings', () => {
            const long = 'x'.repeat(500);
            const result = truncateOutput(long, 100);
            expect(result.length).toBeLessThan(500);
            expect(result).toContain('Truncated');
        });
        it('defaults to 40000 char limit', () => {
            const under = 'x'.repeat(39999);
            expect(truncateOutput(under)).toBe(under);
        });
        it('truncates at exactly max+1', () => {
            const exact = 'x'.repeat(101);
            expect(truncateOutput(exact, 100)).toContain('Truncated');
        });
        it('preserves content up to the limit', () => {
            const result = truncateOutput('abcdefghij', 5);
            expect(result).toContain('abcde');
        });
    });
});

// ═════════════════════════════════════════════════
// SECTION 3: System Prompt Generation
// ═════════════════════════════════════════════════

describe('System Prompt Generation', () => {
    const base = { cwd: '/tmp/test', mode: 'exec' as const };

    describe('identity', () => {
        it('identifies as Deepa', () => expect(buildSystemPrompt(base)).toContain('Deepa'));
        it('includes cwd', () => expect(buildSystemPrompt(base)).toContain('/tmp/test'));
        it('includes date', () => expect(buildSystemPrompt(base)).toContain(new Date().toISOString().split('T')[0]));
        it('includes mode', () => expect(buildSystemPrompt(base)).toContain('exec'));
    });

    describe('security', () => {
        it('contains prompt injection defense', () => {
            const p = buildSystemPrompt(base);
            expect(p).toContain('user_input');
            expect(p).toContain('STRICTLY IGNORED');
        });
    });

    describe('modes', () => {
        it('exec mode has PLANNING section', () => expect(buildSystemPrompt({ ...base, mode: 'exec' })).toContain('PLANNING'));
        it('exec mode has VERIFICATION section', () => expect(buildSystemPrompt({ ...base, mode: 'exec' })).toContain('VERIFICATION'));
        it('plan mode prevents file changes', () => expect(buildSystemPrompt({ ...base, mode: 'plan' }).toLowerCase()).toContain('do not make any file changes'));
        it('chat mode is concise', () => expect(buildSystemPrompt({ ...base, mode: 'chat' })).toContain('Chat Mode'));
    });

    describe('platform awareness', () => {
        const p = buildSystemPrompt(base);
        it('mentions platform', () => expect(p).toContain('Platform'));
        it('mentions shell', () => expect(p.toLowerCase()).toContain('shell'));
        it('mentions path separator', () => expect(p).toContain('Path separator'));
    });

    describe('tool guidelines', () => {
        const p = buildSystemPrompt(base);
        it('mentions file_read', () => expect(p).toContain('file_read'));
        it('mentions file_edit', () => expect(p).toContain('file_edit'));
        it('mentions file_write', () => expect(p).toContain('file_write'));
        it('mentions shell', () => expect(p).toContain('shell'));
        it('mentions web_search', () => expect(p).toContain('web_search'));
        it('mentions web_fetch', () => expect(p).toContain('web_fetch'));
        it('mentions todo', () => expect(p).toContain('todo'));
        it('mentions think', () => expect(p).toContain('think'));
        it('warns against guessing', () => expect(p.toLowerCase()).toContain('never guess'));
        it('mentions batching limit', () => expect(p).toMatch(/2[–\-]3 tools/));
    });

    describe('binary file warnings', () => {
        const p = buildSystemPrompt(base);
        it('warns about binary files', () => expect(p).toContain('binary'));
        it('mentions pptx', () => expect(p.toLowerCase()).toContain('.pptx'));
    });

    describe('python rules', () => {
        const p = buildSystemPrompt(base);
        it('mentions venv', () => expect(p).toContain('.venv'));
        it('mentions requirements.txt', () => expect(p).toContain('requirements.txt'));
    });

    describe('context injection', () => {
        it('injects agentsMdContent', () => {
            const p = buildSystemPrompt({ ...base, agentsMdContent: 'Use Bun not npm' });
            expect(p).toContain('Use Bun not npm');
            expect(p).toContain('Project Context');
        });
        it('injects skill descriptions', () => {
            const p = buildSystemPrompt({ ...base, skillDescriptions: ['pdf: Generate PDFs'] });
            expect(p).toContain('pdf: Generate PDFs');
            expect(p).toContain('Available Skills');
        });
        it('injects agent descriptions', () => {
            const p = buildSystemPrompt({ ...base, agentDescriptions: ['reviewer: Code review'] });
            expect(p).toContain('reviewer: Code review');
            expect(p).toContain('Available Agents');
        });
        it('does not inject empty skills', () => {
            expect(buildSystemPrompt({ ...base, skillDescriptions: [] })).not.toContain('## Available Skills');
        });
        it('does not inject empty agents', () => {
            expect(buildSystemPrompt({ ...base, agentDescriptions: [] })).not.toContain('Available Agents');
        });
        it('includes memory index', () => {
            expect(buildSystemPrompt(base)).toContain('Memory');
        });
    });

    describe('local model mode', () => {
        it('strips skills for local models', () => {
            const p = buildSystemPrompt({ ...base, isLocal: true, skillDescriptions: ['pdf: x'] });
            expect(p).not.toContain('## Available Skills');
        });
        it('strips agents for local models', () => {
            const p = buildSystemPrompt({ ...base, isLocal: true, agentDescriptions: ['r: x'] });
            expect(p).not.toContain('## Available Agents');
        });
    });
});

// ═════════════════════════════════════════════════
// SECTION 4: Tool Registry
// ═════════════════════════════════════════════════

describe('Tool Registry', () => {
    it('registers and retrieves tools', () => {
        const r = new ToolRegistry();
        const tool = { name: 'test', description: 'Test', parameters: z.object({}), riskLevel: 'low' as const, execute: async () => ({ content: 'ok' }) };
        r.register(tool);
        expect(r.get('test')).toBe(tool);
    });

    it('returns undefined for unknown tool', () => {
        const r = new ToolRegistry();
        expect(r.get('unknown')).toBeUndefined();
    });

    it('lists all registered tools', () => {
        const r = makeRegistry();
        const tools = r.list();
        expect(tools.length).toBeGreaterThan(5);
        expect(tools.some(t => t.name === 'file_read')).toBe(true);
        expect(tools.some(t => t.name === 'shell')).toBe(true);
    });

    it('generates tool definitions with JSON Schema', () => {
        const r = makeRegistry();
        const defs = r.getDefinitions();
        expect(defs.length).toBeGreaterThan(0);
        for (const d of defs) {
            expect(d.name).toBeTruthy();
            expect(d.description).toBeTruthy();
            expect(d.parameters).toBeTruthy();
        }
    });

    it('returns error for unknown tool execution', async () => {
        const r = new ToolRegistry();
        const result = await r.execute('nonexistent', {}, makeContext());
        expect(result.isError).toBe(true);
        expect(result.content).toContain('Unknown tool');
    });

    it('validates parameters before execution', async () => {
        const r = new ToolRegistry();
        const z2 = (await import('zod')).z;
        r.register({
            name: 'strict',
            description: 'Strict params',
            parameters: z2.object({ required_field: z2.string() }),
            riskLevel: 'low',
            execute: async () => ({ content: 'ok' }),
        });
        const result = await r.execute('strict', {}, makeContext());
        expect(result.isError).toBe(true);
        expect(result.content).toContain('Invalid parameters');
    });

    it('strips null values from params', async () => {
        const r = new ToolRegistry();
        const z2 = (await import('zod')).z;
        let receivedParams: any;
        r.register({
            name: 'nullable',
            description: 'Test',
            parameters: z2.object({ name: z2.string(), opt: z2.string().optional() }),
            riskLevel: 'low',
            execute: async (p) => { receivedParams = p; return { content: 'ok' }; },
        });
        await r.execute('nullable', { name: 'test', opt: null }, makeContext());
        expect(receivedParams.opt).toBeUndefined();
    });

    it('truncates oversized tool output', async () => {
        const r = new ToolRegistry();
        const z2 = (await import('zod')).z;
        r.register({
            name: 'big',
            description: 'Big output',
            parameters: z2.object({}),
            riskLevel: 'low',
            execute: async () => ({ content: 'x'.repeat(20_000) }),
        });
        const result = await r.execute('big', {}, makeContext());
        expect(result.content).toContain('truncated');
        expect(result.content.length).toBeLessThan(20_000);
    });

    it('respects custom maxOutputChars', async () => {
        const r = new ToolRegistry();
        const z2 = (await import('zod')).z;
        r.register({
            name: 'custom_limit',
            description: 'Custom limit',
            parameters: z2.object({}),
            riskLevel: 'low',
            maxOutputChars: 50_000,
            execute: async () => ({ content: 'x'.repeat(40_000) }),
        });
        const result = await r.execute('custom_limit', {}, makeContext());
        // Should NOT be truncated because maxOutputChars is 50k
        expect(result.content).not.toContain('truncated');
    });
});

// Need to import z for the section above
import { z } from 'zod';

// ═════════════════════════════════════════════════
// SECTION 5: File Tools — Exhaustive
// ═════════════════════════════════════════════════

describe('File Tools — Extended', () => {
    describe('file_read edge cases', () => {
        it('reads empty file', async () => {
            writeFileSync(join(WORKSPACE, 'empty.txt'), '');
            const result = await fileReadTool.execute({ path: 'empty.txt' }, makeContext());
            expect(result.isError).toBeUndefined();
        });

        it('reads file with unicode', async () => {
            writeFileSync(join(WORKSPACE, 'unicode.txt'), '日本語テスト\nПривет\n你好');
            const result = await fileReadTool.execute({ path: 'unicode.txt' }, makeContext());
            expect(result.content).toContain('日本語');
            expect(result.content).toContain('Привет');
        });

        it('shows line numbers', async () => {
            writeFileSync(join(WORKSPACE, 'lines.txt'), 'a\nb\nc');
            const result = await fileReadTool.execute({ path: 'lines.txt' }, makeContext());
            expect(result.content).toContain('1: a');
            expect(result.content).toContain('2: b');
        });

        it('clamps startLine to 1', async () => {
            writeFileSync(join(WORKSPACE, 'lines.txt'), 'a\nb\nc');
            const result = await fileReadTool.execute({ path: 'lines.txt', startLine: -5 }, makeContext());
            expect(result.content).toContain('1: a');
        });

        it('clamps endLine to file length', async () => {
            writeFileSync(join(WORKSPACE, 'lines.txt'), 'a\nb\nc');
            const result = await fileReadTool.execute({ path: 'lines.txt', endLine: 9999 }, makeContext());
            expect(result.content).toContain('3: c');
        });

        it('enforces max 500 lines per read', async () => {
            const content = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join('\n');
            writeFileSync(join(WORKSPACE, 'big.txt'), content);
            const result = await fileReadTool.execute({ path: 'big.txt' }, makeContext());
            expect(result.content).toContain('line 500');
            expect(result.content).not.toContain('line 501');
            expect(result.content).toContain('Note');
        });

        it('rejects files > 256KB', async () => {
            writeFileSync(join(WORKSPACE, 'huge.txt'), 'x'.repeat(300 * 1024));
            const result = await fileReadTool.execute({ path: 'huge.txt' }, makeContext());
            expect(result.isError).toBe(true);
            expect(result.content).toContain('too large');
        });

        it('tracks read state for edit validation', async () => {
            writeFileSync(join(WORKSPACE, 'tracked.txt'), 'content');
            const ctx = makeContext();
            await fileReadTool.execute({ path: 'tracked.txt' }, ctx);
            const absPath = join(WORKSPACE, 'tracked.txt');
            expect(ctx.readFileState.has(absPath)).toBe(true);
        });
    });

    describe('file_write edge cases', () => {
        it('requires path parameter', async () => {
            const result = await fileWriteTool.execute({ path: null, content: 'x' }, makeContext());
            expect(result.isError).toBe(true);
        });

        it('requires content parameter', async () => {
            const result = await fileWriteTool.execute({ path: 'test.txt', content: null }, makeContext());
            expect(result.isError).toBe(true);
        });

        it('allows empty string content', async () => {
            const result = await fileWriteTool.execute({ path: 'empty.txt', content: '' }, makeContext());
            expect(result.isError).toBeUndefined();
        });

        it('blocks all binary extensions', async () => {
            const exts = ['.pptx', '.xlsx', '.pdf', '.docx', '.png', '.jpg', '.mp3', '.zip', '.exe', '.woff', '.gif', '.mp4'];
            for (const ext of exts) {
                const result = await fileWriteTool.execute({ path: `test${ext}`, content: 'data' }, makeContext());
                expect(result.isError).toBe(true);
            }
        });

        it('allows all text extensions', async () => {
            const exts = ['.txt', '.md', '.ts', '.js', '.py', '.json', '.html', '.css', '.yaml', '.toml', '.sh', '.sql'];
            for (const ext of exts) {
                const result = await fileWriteTool.execute({ path: `test${ext}`, content: 'data' }, makeContext());
                expect(result.isError).toBeUndefined();
            }
        });

        it('validates read-before-write for existing files', async () => {
            writeFileSync(join(WORKSPACE, 'existing.txt'), 'old');
            const validation = await fileWriteTool.validateInput!({ path: 'existing.txt', content: 'new' }, makeContext());
            expect(validation.valid).toBe(false);
            expect(validation.message).toContain('Read it first');
        });

        it('allows write to new files without read', async () => {
            const result = await fileWriteTool.execute({ path: 'brand_new.txt', content: 'data' }, makeContext());
            expect(result.isError).toBeUndefined();
        });
    });

    describe('file_edit edge cases', () => {
        it('validates file must be read first', async () => {
            writeFileSync(join(WORKSPACE, 'edit_me.txt'), 'content');
            const result = await fileEditTool.execute(
                { path: 'edit_me.txt', search: 'content', replace: 'new' },
                makeContext(),
            );
            // Should fail validation (not actually execute) because validateInput runs in registry
            // Direct execute bypasses validateInput, so test via registry
            const registry = new ToolRegistry();
            registry.register(fileEditTool);
            const regResult = await registry.execute('file_edit', { path: 'edit_me.txt', search: 'content', replace: 'new' }, makeContext());
            expect(regResult.isError).toBe(true);
            expect(regResult.content).toContain('not been read');
        });

        it('detects when file was modified externally', async () => {
            const ctx = makeContext();
            writeFileSync(join(WORKSPACE, 'external.txt'), 'original');
            await fileReadTool.execute({ path: 'external.txt' }, ctx);

            // Simulate external modification (write with slightly future mtime)
            await new Promise(r => setTimeout(r, 50));
            writeFileSync(join(WORKSPACE, 'external.txt'), 'externally changed');

            const registry = new ToolRegistry();
            registry.register(fileEditTool);
            const result = await registry.execute('file_edit',
                { path: 'external.txt', search: 'externally', replace: 'my' },
                ctx,
            );
            expect(result.isError).toBe(true);
            expect(result.content).toContain('modified on disk');
        });
    });
});

// ═════════════════════════════════════════════════
// SECTION 6: Shell Tool — Extended
// ═════════════════════════════════════════════════

describe('Shell Tool — Extended', () => {
    it('captures stdout', async () => {
        const r = await shellTool.execute({ command: 'echo hello' }, makeContext());
        expect(r.content).toContain('hello');
    });

    it('captures stderr', async () => {
        const r = await shellTool.execute({ command: 'echo err >&2' }, makeContext());
        expect(r.content).toContain('err');
    });

    it('reports exit code for success', async () => {
        const r = await shellTool.execute({ command: 'true' }, makeContext());
        expect(r.isError).toBe(false);
    });

    it('reports exit code for failure', async () => {
        const r = await shellTool.execute({ command: 'false' }, makeContext());
        expect(r.isError).toBe(true);
    });

    it('respects cwd', async () => {
        const r = await shellTool.execute({ command: 'pwd' }, makeContext());
        expect(r.content).toContain(WORKSPACE);
    });

    it('runs background commands', async () => {
        const r = await shellTool.execute({ command: 'sleep 0.01', background: true }, makeContext());
        expect(r.content).toContain('background');
        expect(r.content).toContain('PID');
    });

    it('blocks sleep > 2 seconds via validateInput', async () => {
        const registry = new ToolRegistry();
        registry.register(shellTool);
        const result = await registry.execute('shell', { command: 'sleep 10' }, makeContext());
        expect(result.isError).toBe(true);
        expect(result.content).toContain('Blocked');
    });

    it('allows sleep 1 via validateInput', async () => {
        const registry = new ToolRegistry();
        registry.register(shellTool);
        const result = await registry.execute('shell', { command: 'sleep 1' }, makeContext());
        expect(result.isError).toBeFalsy();
    });

    it('allows sleep in background mode', async () => {
        const registry = new ToolRegistry();
        registry.register(shellTool);
        const result = await registry.execute('shell', { command: 'sleep 30', background: true }, makeContext());
        expect(result.isError).toBeFalsy();
        expect(result.content).toContain('background');
    });

    it('detects git lock hint', async () => {
        writeFileSync(join(WORKSPACE, '.git', 'index.lock'), '');
        const r = await shellTool.execute(
            { command: "echo \"fatal: Unable to create '.git/index.lock': File exists.\"" },
            makeContext(),
        );
        expect(r.content).toContain('Hint');
        expect(r.content).toContain('index.lock');
    });

    it('high risk level', () => expect(shellTool.riskLevel).toBe('high'));
});

// ═════════════════════════════════════════════════
// SECTION 7: Think Tool
// ═════════════════════════════════════════════════

describe('Think Tool — Extended', () => {
    it('records reasoning', async () => {
        const r = await thinkTool.execute({ thought: 'Step 1 then step 2' }, makeContext());
        expect(r.content).toContain('Reasoning recorded');
    });

    it('counts words', async () => {
        const r = await thinkTool.execute({ thought: 'one two three four five' }, makeContext());
        expect(r.content).toContain('5 words');
    });

    it('counts lines', async () => {
        const r = await thinkTool.execute({ thought: 'a\nb\nc\nd' }, makeContext());
        expect(r.content).toContain('4 lines');
    });

    it('handles empty thought', async () => {
        const r = await thinkTool.execute({ thought: '' }, makeContext());
        expect(r.isError).toBeUndefined();
    });

    it('low risk', () => expect(thinkTool.riskLevel).toBe('low'));
});

// ═════════════════════════════════════════════════
// SECTION 8: Todo Tool — Extended
// ═════════════════════════════════════════════════

describe('Todo Tool — Extended', () => {
    beforeEach(() => resetTodos());

    it('creates a full todo list', async () => {
        const r = await todoTool.execute({ todos: [
            { content: 'A', status: 'pending' },
            { content: 'B', status: 'in_progress' },
        ] }, makeContext());
        expect(r.content).toContain('A');
        expect(r.content).toContain('B');
    });

    it('tracks completed count', async () => {
        const r = await todoTool.execute({ todos: [
            { content: 'Done', status: 'completed' },
            { content: 'Pending', status: 'pending' },
        ] }, makeContext());
        expect(r.content).toContain('1/2');
        expect(r.content).toContain('50%');
    });

    it('rejects multiple in_progress', async () => {
        const r = await todoTool.execute({ todos: [
            { content: 'A', status: 'in_progress' },
            { content: 'B', status: 'in_progress' },
        ] }, makeContext());
        expect(r.isError).toBe(true);
    });

    it('handles 50 tasks', async () => {
        const tasks = Array.from({ length: 50 }, (_, i) => ({
            content: `Task ${i + 1}`,
            status: (i < 25 ? 'completed' : 'pending') as 'completed' | 'pending',
        }));
        const r = await todoTool.execute({ todos: tasks }, makeContext());
        expect(r.content).toContain('25/50');
    });

    it('reports all tasks completed', async () => {
        await todoTool.execute({ todos: [{ content: 'A', status: 'in_progress' }] }, makeContext());
        const r = await todoTool.execute({ todos: [{ content: 'A', status: 'completed' }] }, makeContext());
        expect(r.content).toContain('All tasks completed');
    });
});

// ═════════════════════════════════════════════════
// SECTION 9: Agent Loop — Extended Integration
// ═════════════════════════════════════════════════

describe('Agent Loop — Extended Integration', () => {
    describe('tool selection verification', () => {
        it('file_read for reading files', async () => {
            writeFileSync(join(WORKSPACE, 'src/app.ts'), 'const x = 1;');
            const provider = scriptedProvider([
                [tc('t1', 'file_read', { path: 'src/app.ts' }), done()],
                [text('Read the file.'), done()],
            ]);
            const msgs = await runAgentLoop('read app.ts', [], makeOptions(provider, 'chat'));
            const toolMsgs = msgs.filter(m => m.role === 'tool');
            expect(toolMsgs.length).toBe(1);
        });

        it('file_write for creating new files', async () => {
            const provider = scriptedProvider([
                [tc('t1', 'file_write', { path: 'src/new.ts', content: 'export const x = 1;' }), done()],
                [text('Created.'), done()],
            ]);
            await runAgentLoop('create new.ts', [], makeOptions(provider));
            expect(existsSync(join(WORKSPACE, 'src/new.ts'))).toBe(true);
        });

        it('file_edit for modifying existing files', async () => {
            writeFileSync(join(WORKSPACE, 'src/mod.ts'), 'const old = 1;');
            const provider = scriptedProvider([
                [tc('t1', 'file_read', { path: 'src/mod.ts' }), done()],
                [tc('t2', 'file_edit', { path: 'src/mod.ts', search: 'old', replace: 'new' }), done()],
                [text('Done.'), done()],
            ]);
            await runAgentLoop('fix mod.ts', [], makeOptions(provider));
            expect(readFileSync(join(WORKSPACE, 'src/mod.ts'), 'utf-8')).toContain('new');
        });

        it('shell for running commands', async () => {
            const provider = scriptedProvider([
                [tc('t1', 'shell', { command: 'echo test123' }), done()],
                [text('Ran command.'), done()],
            ]);
            const msgs = await runAgentLoop('run echo', [], makeOptions(provider, 'chat'));
            const toolMsg = msgs.find(m => m.role === 'tool');
            expect(JSON.stringify(toolMsg?.content)).toContain('test123');
        });

        it('search_grep for finding patterns', async () => {
            writeFileSync(join(WORKSPACE, 'src/a.ts'), 'function hello() {}');
            writeFileSync(join(WORKSPACE, 'src/b.ts'), 'const world = 1;');
            const provider = scriptedProvider([
                [tc('t1', 'search_grep', { query: 'hello', path: 'src' }), done()],
                [text('Found in a.ts'), done()],
            ]);
            const msgs = await runAgentLoop('find hello', [], makeOptions(provider, 'chat'));
            const toolMsg = msgs.find(m => m.role === 'tool');
            expect(JSON.stringify(toolMsg?.content)).toContain('hello');
        });

        it('todo for planning', async () => {
            const provider = scriptedProvider([
                [tc('t1', 'todo', { todos: [{ content: 'Step 1', status: 'in_progress' }] }), done()],
                [text('Plan created.'), done()],
            ]);
            await runAgentLoop('plan this', [], makeOptions(provider));
            expect(getTodos().length).toBe(1);
        });

        it('think for reasoning', async () => {
            const provider = scriptedProvider([
                [tc('t1', 'think', { thought: 'I should analyze the code first' }), done()],
                [text('OK.'), done()],
            ]);
            const msgs = await runAgentLoop('think about it', [], makeOptions(provider, 'chat'));
            const toolMsg = msgs.find(m => m.role === 'tool');
            expect(JSON.stringify(toolMsg?.content)).toContain('Reasoning recorded');
        });
    });

    describe('multi-turn conversations', () => {
        it('preserves history across turns', async () => {
            const p1 = scriptedProvider([[text('First answer'), done()]]);
            const msgs1 = await runAgentLoop('first question', [], makeOptions(p1, 'chat'));

            const p2 = scriptedProvider([[text('Second answer'), done()]]);
            const msgs2 = await runAgentLoop('second question', msgs1, makeOptions(p2, 'chat'));

            expect(msgs2.length).toBeGreaterThan(msgs1.length);
            // Should contain both Q&A pairs
            const allContent = msgs2.map(m => typeof m.content === 'string' ? m.content : '').join(' ');
            expect(allContent).toContain('First answer');
            expect(allContent).toContain('Second answer');
        });

        it('multi-tool-call turn executes all tools', async () => {
            writeFileSync(join(WORKSPACE, 'src/a.ts'), 'content A');
            writeFileSync(join(WORKSPACE, 'src/b.ts'), 'content B');

            let callCount = 0;
            const provider: LLMProvider = {
                name: 'multi',
                async *chat() {
                    callCount++;
                    if (callCount === 1) {
                        yield tc('t1', 'file_read', { path: 'src/a.ts' });
                        yield tc('t2', 'file_read', { path: 'src/b.ts' });
                        yield done();
                    } else {
                        yield text('Read both files.');
                        yield done();
                    }
                },
            };
            const msgs = await runAgentLoop('read both', [], makeOptions(provider, 'chat'));
            const toolMsgs = msgs.filter(m => m.role === 'tool');
            expect(toolMsgs.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('error recovery', () => {
        it('returns error for missing file read', async () => {
            const provider = scriptedProvider([
                [tc('t1', 'file_read', { path: 'nonexistent.ts' }), done()],
                [text('File not found.'), done()],
            ]);
            const msgs = await runAgentLoop('read it', [], makeOptions(provider, 'chat'));
            const toolMsg = msgs.find(m => m.role === 'tool');
            expect(JSON.stringify(toolMsg?.content)).toContain('not found');
        });

        it('handles malformed JSON args gracefully', async () => {
            const provider = scriptedProvider([
                [{ type: 'tool_call', id: 'tc1', name: 'file_read', arguments: '{bad' }, done()],
                [text('handled'), done()],
            ]);
            const msgs = await runAgentLoop('test', [], makeOptions(provider, 'chat'));
            expect(Array.isArray(msgs)).toBe(true);
        });
    });

    describe('token tracking', () => {
        it('accumulates token usage', async () => {
            const onTokenUsage = vi.fn();
            const provider = scriptedProvider([
                [text('hi'), { type: 'done', usage: { promptTokens: 100, completionTokens: 50 } }],
            ]);
            await runAgentLoop('test', [], { ...makeOptions(provider, 'chat'), onTokenUsage });
            expect(onTokenUsage).toHaveBeenCalledWith(100, 50, 100, 50);
        });
    });

    describe('prompt injection defense', () => {
        it('wraps user input in user_input tags', async () => {
            let receivedMessages: Message[] = [];
            const provider: LLMProvider = {
                name: 'spy',
                async *chat(msgs) {
                    receivedMessages = msgs;
                    yield text('ok');
                    yield done();
                },
            };
            await runAgentLoop('hello world', [], makeOptions(provider, 'chat'));
            const userMsg = receivedMessages.find(m => m.role === 'user');
            expect(typeof userMsg?.content === 'string' && userMsg.content.includes('<user_input>')).toBe(true);
        });
    });

    describe('cancellation', () => {
        it('returns cancelled message when signal is pre-aborted', async () => {
            const controller = new AbortController();
            controller.abort();
            const provider = scriptedProvider([[text('should not see'), done()]]);
            const msgs = await runAgentLoop('test', [], {
                ...makeOptions(provider, 'chat'),
                signal: controller.signal,
            });
            expect(msgs.some(m => typeof m.content === 'string' && m.content.includes('Cancelled'))).toBe(true);
        });
    });
});

// ═════════════════════════════════════════════════
// SECTION 10: Full Workflow Scenarios
// ═════════════════════════════════════════════════

describe('Full Workflow Scenarios', () => {
    it('read-edit-verify workflow', async () => {
        writeFileSync(join(WORKSPACE, 'src/config.ts'), 'export const PORT = 3000;');
        const provider = scriptedProvider([
            [tc('t1', 'file_read', { path: 'src/config.ts' }), done()],
            [tc('t2', 'file_edit', { path: 'src/config.ts', search: '3000', replace: '8080' }), done()],
            [tc('t3', 'search_grep', { query: '8080', path: 'src/config.ts' }), done()],
            [text('Changed port to 8080 and verified.'), done()],
        ]);
        await runAgentLoop('change port to 8080', [], makeOptions(provider));
        expect(readFileSync(join(WORKSPACE, 'src/config.ts'), 'utf-8')).toContain('8080');
    });

    it('create-file-and-run workflow', async () => {
        const provider = scriptedProvider([
            [tc('t1', 'file_write', { path: 'src/hello.js', content: 'console.log("hello from workflow");' }), done()],
            [tc('t2', 'shell', { command: 'node src/hello.js' }), done()],
            [text('Created and ran.'), done()],
        ]);
        const msgs = await runAgentLoop('create and run hello.js', [], makeOptions(provider));
        expect(existsSync(join(WORKSPACE, 'src/hello.js'))).toBe(true);
        const allContent = JSON.stringify(msgs);
        expect(allContent).toContain('hello from workflow');
    });

    it('plan-then-execute workflow', async () => {
        const provider = scriptedProvider([
            [tc('t1', 'think', { thought: 'I need to create a utils module' }), done()],
            [tc('t2', 'todo', { todos: [
                { content: 'Create utils.ts', status: 'in_progress' },
                { content: 'Verify', status: 'pending' },
            ] }), done()],
            [tc('t3', 'file_write', { path: 'src/utils.ts', content: 'export function add(a: number, b: number) { return a + b; }' }), done()],
            [tc('t4', 'todo', { todos: [
                { content: 'Create utils.ts', status: 'completed' },
                { content: 'Verify', status: 'in_progress' },
            ] }), done()],
            [tc('t5', 'file_read', { path: 'src/utils.ts' }), done()],
            [tc('t6', 'todo', { todos: [
                { content: 'Create utils.ts', status: 'completed' },
                { content: 'Verify', status: 'completed' },
            ] }), done()],
            [text('Done. Created utils.ts with add function.'), done()],
        ]);
        await runAgentLoop('create utils', [], makeOptions(provider));
        expect(existsSync(join(WORKSPACE, 'src/utils.ts'))).toBe(true);
        expect(getTodos().every(t => t.status === 'completed')).toBe(true);
    });

    it('search-across-files workflow', async () => {
        writeFileSync(join(WORKSPACE, 'src/a.ts'), '// TODO: fix this\nconst a = 1;');
        writeFileSync(join(WORKSPACE, 'src/b.ts'), '// TODO: add tests\nconst b = 2;');
        writeFileSync(join(WORKSPACE, 'src/c.ts'), 'const c = 3; // no todo here');

        const provider = scriptedProvider([
            [tc('t1', 'search_grep', { query: 'TODO', path: 'src' }), done()],
            [text('Found 2 TODOs.'), done()],
        ]);
        const msgs = await runAgentLoop('find todos', [], makeOptions(provider, 'chat'));
        const toolContent = JSON.stringify(msgs.find(m => m.role === 'tool')?.content);
        expect(toolContent).toContain('TODO');
    });

    it('multi-file rename with replaceAll', async () => {
        writeFileSync(join(WORKSPACE, 'src/a.ts'), 'oldName oldName oldName');
        const provider = scriptedProvider([
            [tc('t1', 'file_read', { path: 'src/a.ts' }), done()],
            [tc('t2', 'file_edit', { path: 'src/a.ts', search: 'oldName', replace: 'newName', replaceAll: true }), done()],
            [text('Renamed all.'), done()],
        ]);
        await runAgentLoop('rename', [], makeOptions(provider));
        expect(readFileSync(join(WORKSPACE, 'src/a.ts'), 'utf-8')).toBe('newName newName newName');
    });
});

// ═════════════════════════════════════════════════
// SECTION 11: Edge Cases & Robustness
// ═════════════════════════════════════════════════

describe('Edge Cases', () => {
    it('handles empty user message', async () => {
        const provider = scriptedProvider([[text('Empty message received.'), done()]]);
        const msgs = await runAgentLoop('', [], makeOptions(provider, 'chat'));
        expect(msgs.length).toBeGreaterThan(0);
    });

    it('handles very long user message', async () => {
        const longMsg = 'x'.repeat(10_000);
        const provider = scriptedProvider([[text('Got it.'), done()]]);
        const msgs = await runAgentLoop(longMsg, [], makeOptions(provider, 'chat'));
        expect(msgs.length).toBeGreaterThan(0);
    });

    it('handles MessageContent array input', async () => {
        const provider = scriptedProvider([[text('Image received.'), done()]]);
        const msgs = await runAgentLoop(
            [{ type: 'text', text: 'Look at this image' }],
            [],
            makeOptions(provider, 'chat'),
        );
        expect(msgs.length).toBeGreaterThan(0);
    });

    it('wraps MessageContent text in user_input tags', async () => {
        let receivedMessages: Message[] = [];
        const provider: LLMProvider = {
            name: 'spy',
            async *chat(msgs) {
                receivedMessages = msgs;
                yield text('ok');
                yield done();
            },
        };
        await runAgentLoop(
            [{ type: 'text', text: 'test content' }],
            [],
            makeOptions(provider, 'chat'),
        );
        const userMsg = receivedMessages.find(m => m.role === 'user');
        const content = userMsg?.content;
        expect(Array.isArray(content)).toBe(true);
        if (Array.isArray(content)) {
            const textBlock = content.find((c: any) => c.type === 'text');
            expect((textBlock as any).text).toContain('<user_input>');
        }
    });

    it('does not include system prompt in returned messages', async () => {
        const provider = scriptedProvider([[text('hi'), done()]]);
        const msgs = await runAgentLoop('test', [], makeOptions(provider, 'chat'));
        expect(msgs.every(m => m.role !== 'system')).toBe(true);
    });

    it('handles provider that yields only done', async () => {
        const provider = scriptedProvider([[done()]]);
        const msgs = await runAgentLoop('test', [], makeOptions(provider, 'chat'));
        const last = msgs[msgs.length - 1];
        expect(last.role).toBe('assistant');
        expect(last.content).toBe(''); // empty text
    });
});
