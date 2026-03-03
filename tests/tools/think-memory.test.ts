// ─── Think & Memory tool tests ───

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { thinkTool } from '../../src/tools/think.js';
import { memoryTool } from '../../src/tools/memory.js';
import type { ToolContext } from '../../src/types.js';

const TEST_DIR = join(tmpdir(), 'deepa-cli-test-think-memory-' + Date.now());

function makeContext(): ToolContext {
    return {
        cwd: TEST_DIR,
        autonomy: 'high',
        confirmAction: async () => true,
        log: () => { },
    };
}

// ─── Think Tool ───

describe('Think Tool', () => {
    it('returns confirmation with word count', async () => {
        const result = await thinkTool.execute(
            { thought: 'I need to think about this step by step' },
            makeContext(),
        );
        expect(result.content).toContain('Reasoning recorded');
        expect(result.content).toContain('9 words');
    });

    it('returns confirmation with line count', async () => {
        const result = await thinkTool.execute(
            { thought: 'Line one\nLine two\nLine three' },
            makeContext(),
        );
        expect(result.content).toContain('3 lines');
    });

    it('handles single word input', async () => {
        const result = await thinkTool.execute(
            { thought: 'hmm' },
            makeContext(),
        );
        expect(result.content).toContain('1 words');
        expect(result.content).toContain('1 lines');
        expect(result.isError).toBeUndefined();
    });

    it('handles multi-paragraph reasoning', async () => {
        const thought = `First, I'll analyze the architecture.
The system has three layers: API, service, and data.

Then I'll check the dependencies.
Finally I'll propose the changes.`;
        const result = await thinkTool.execute({ thought }, makeContext());
        expect(result.content).toContain('Reasoning recorded');
        expect(result.isError).toBeUndefined();
    });

    it('has low risk level', () => {
        expect(thinkTool.riskLevel).toBe('low');
    });

    it('has correct name', () => {
        expect(thinkTool.name).toBe('think');
    });
});

// ─── Memory Tool ───

describe('Memory Tool', () => {
    const MEMORY_DIR = join(homedir(), '.deepa', 'memory');

    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    describe('save action', () => {
        it('saves a global memory', async () => {
            const result = await memoryTool.execute(
                {
                    action: 'save',
                    key: 'test_global_pref',
                    content: 'User prefers TypeScript strict mode.',
                    scope: 'global',
                },
                makeContext(),
            );
            expect(result.content).toContain('Memory saved');
            expect(result.content).toContain('test_global_pref');
            expect(result.content).toContain('global');
            expect(result.isError).toBeUndefined();

            // Verify file exists
            const filePath = join(MEMORY_DIR, 'global', 'test_global_pref.md');
            expect(existsSync(filePath)).toBe(true);
            expect(readFileSync(filePath, 'utf-8')).toBe('User prefers TypeScript strict mode.');
        });

        it('saves a project-scoped memory', async () => {
            const result = await memoryTool.execute(
                {
                    action: 'save',
                    key: 'test_project_note',
                    content: 'This project uses Bun.',
                    scope: 'project',
                },
                makeContext(),
            );
            expect(result.content).toContain('Memory saved');
            expect(result.content).toContain('project');
            expect(result.isError).toBeUndefined();
        });

        it('defaults to project scope', async () => {
            const result = await memoryTool.execute(
                {
                    action: 'save',
                    key: 'test_default_scope',
                    content: 'Default scope test.',
                },
                makeContext(),
            );
            expect(result.content).toContain('project');
        });

        it('returns error when key is missing', async () => {
            const result = await memoryTool.execute(
                { action: 'save', content: 'some content' },
                makeContext(),
            );
            expect(result.isError).toBe(true);
            expect(result.content).toContain('key');
        });

        it('returns error when content is missing', async () => {
            const result = await memoryTool.execute(
                { action: 'save', key: 'test_key' },
                makeContext(),
            );
            expect(result.isError).toBe(true);
            expect(result.content).toContain('content');
        });
    });

    describe('read action', () => {
        it('reads summary of saved memories when no key is provided', async () => {
            await memoryTool.execute(
                {
                    action: 'save',
                    key: 'test_read_note',
                    content: 'Remember this fact.',
                    scope: 'global',
                },
                makeContext(),
            );

            const result = await memoryTool.execute(
                { action: 'read' },
                makeContext(),
            );
            // It should be in the preview list
            expect(result.content).toContain('test_read_note');
            expect(result.content).toContain('Remember this fact');
            expect(result.content).toContain('Available memories');
        });

        it('reads full contents when a specific key is provided', async () => {
            const longContent = 'Line 1\nLine 2\nLine 3\nLine 4\nVery long detailed content that should not be in the preview.';
            await memoryTool.execute(
                {
                    action: 'save',
                    key: 'test_read_specific',
                    content: longContent,
                    scope: 'project',
                },
                makeContext(),
            );

            // General read should have preview (first line)
            const listResult = await memoryTool.execute({ action: 'read' }, makeContext());
            expect(listResult.content).toContain('test_read_specific');
            expect(listResult.content).toContain('Line 1');
            expect(listResult.content).not.toContain('Very long detailed content');

            // Targeted read should have full content
            const specificResult = await memoryTool.execute({ action: 'read', key: 'test_read_specific' }, makeContext());
            expect(specificResult.content).toContain(longContent);
            expect(specificResult.content).toContain('[test_read_specific (project)]');
        });
    });

    describe('list action', () => {
        it('lists saved memory keys', async () => {
            // Save a memory first
            await memoryTool.execute(
                {
                    action: 'save',
                    key: 'test_list_item',
                    content: 'Listed content.',
                    scope: 'global',
                },
                makeContext(),
            );

            const result = await memoryTool.execute(
                { action: 'list' },
                makeContext(),
            );
            expect(result.content).toContain('test_list_item');
            expect(result.content).toContain('global');
            expect(result.isError).toBeUndefined();
        });
    });

    describe('metadata', () => {
        it('has low risk level', () => {
            expect(memoryTool.riskLevel).toBe('low');
        });

        it('has correct name', () => {
            expect(memoryTool.name).toBe('memory');
        });
    });

    // Cleanup test memories
    afterEach(() => {
        // Clean up test files from global memory
        const globalDir = join(MEMORY_DIR, 'global');
        if (existsSync(globalDir)) {
            for (const file of readdirSync(globalDir)) {
                if (file.startsWith('test_')) {
                    rmSync(join(globalDir, file), { force: true });
                }
            }
        }
    });
});
