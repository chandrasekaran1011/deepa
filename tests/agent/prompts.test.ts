// ─── System prompt tests ───

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/agent/prompts.js';
import { platform } from 'os';

const BASE_OPTS = {
    cwd: '/home/user/project',
    mode: 'chat' as const,
};

describe('buildSystemPrompt', () => {

    describe('Common header', () => {
        it('includes the current working directory', () => {
            const prompt = buildSystemPrompt({ ...BASE_OPTS, cwd: '/my/project' });
            expect(prompt).toContain('/my/project');
        });

        it('includes todays date in ISO format', () => {
            const prompt = buildSystemPrompt(BASE_OPTS);
            const today = new Date().toISOString().split('T')[0];
            expect(prompt).toContain(today);
        });

        it('includes the OS platform', () => {
            const prompt = buildSystemPrompt(BASE_OPTS);
            expect(prompt).toContain(platform());
        });

        it('includes shell information', () => {
            const prompt = buildSystemPrompt(BASE_OPTS);
            expect(prompt.toLowerCase()).toMatch(/shell/);
        });

        it('mentions web_search tool availability', () => {
            const prompt = buildSystemPrompt(BASE_OPTS);
            expect(prompt).toContain('web_search');
        });
    });

    describe('Mode-specific instructions', () => {
        it('chat mode includes interactive chat instructions', () => {
            const prompt = buildSystemPrompt({ ...BASE_OPTS, mode: 'chat' });
            expect(prompt.toLowerCase()).toContain('chat');
        });

        it('plan mode includes read-only restriction', () => {
            const prompt = buildSystemPrompt({ ...BASE_OPTS, mode: 'plan' });
            expect(prompt).toContain('PLAN MODE');
            expect(prompt.toLowerCase()).toContain('do not make any file changes');
        });

        it('plan mode mentions todo tool for checklist', () => {
            const prompt = buildSystemPrompt({ ...BASE_OPTS, mode: 'plan' });
            expect(prompt).toContain('todo');
        });

        it('exec mode includes planning step', () => {
            const prompt = buildSystemPrompt({ ...BASE_OPTS, mode: 'exec' });
            // The new prompt uses "PLANNING (AFTER think)" instead of "PLANNING (MANDATORY FIRST STEP)"
            expect(prompt).toContain('PLANNING');
        });

        it('exec mode includes verification step', () => {
            const prompt = buildSystemPrompt({ ...BASE_OPTS, mode: 'exec' });
            expect(prompt).toContain('VERIFICATION');
        });

        it('exec mode mentions todo tool for plan tracking', () => {
            const prompt = buildSystemPrompt({ ...BASE_OPTS, mode: 'exec' });
            expect(prompt).toContain('todo');
        });
    });

    describe('Tool discipline guidelines', () => {
        it('instructs agent to use file_read before editing', () => {
            const prompt = buildSystemPrompt(BASE_OPTS);
            expect(prompt).toContain('file_read');
        });

        it('instructs not to guess file contents', () => {
            const prompt = buildSystemPrompt(BASE_OPTS);
            expect(prompt.toLowerCase()).toContain('never guess');
        });

        it('mentions tool call batching limit', () => {
            const prompt = buildSystemPrompt(BASE_OPTS);
            expect(prompt).toMatch(/2[–\-–]3 tools|2-3 tools/i);
        });
    });

    describe('Context injection', () => {
        it('injects AGENTS.md content when provided', () => {
            const prompt = buildSystemPrompt({
                ...BASE_OPTS,
                agentsMdContent: 'This project uses Bun instead of npm.',
            });
            expect(prompt).toContain('This project uses Bun instead of npm.');
            // The section header is "Project Context" now, not "AGENTS.md"
            expect(prompt).toContain('Project Context');
        });

        it('does not add Project Context section when content is absent', () => {
            const prompt = buildSystemPrompt(BASE_OPTS);
            expect(prompt).not.toContain('Project Context');
        });

        it('memory index is always present in prompt', () => {
            const prompt = buildSystemPrompt(BASE_OPTS);
            // Memory is now always injected via loadPrimaryMemoryIndex
            expect(prompt).toContain('Memory');
        });

        it('injects all context sections when all provided', () => {
            const prompt = buildSystemPrompt({
                ...BASE_OPTS,
                agentsMdContent: 'agents context',
                skillDescriptions: ['skill one'],
            });
            expect(prompt).toContain('agents context');
            expect(prompt).toContain('skill one');
        });
    });
});
