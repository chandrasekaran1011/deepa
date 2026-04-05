// ─── Think tool tests ───
// Memory tool was removed — memory is now handled via file_write to ~/.deepa/memory

import { describe, it, expect } from 'vitest';
import { thinkTool } from '../../src/tools/think.js';
import type { ToolContext } from '../../src/types.js';

function makeContext(): ToolContext {
    return {
        cwd: '/tmp',
        autonomy: 'high',
        confirmAction: async () => true,
        log: () => { },
        readFileState: new Map(),
        messages: [],
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
