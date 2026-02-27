// ─── Tests for select prompt module ───
// Note: selectPrompt requires a TTY for interactive mode.
// These tests verify the non-TTY fallback behavior and module structure.

import { describe, it, expect } from 'vitest';
import { selectPrompt } from '../../src/ui/select.js';

describe('Select Prompt', () => {
    it('exports selectPrompt function', () => {
        expect(typeof selectPrompt).toBe('function');
    });

    // Non-TTY environments (like test runner) should fall through to first option
    it('returns first option value in non-TTY environment', async () => {
        // In test environment, process.stdin.isTTY is falsy
        const result = await selectPrompt([
            { label: 'Allow', value: 'allow' },
            { label: 'Deny', value: 'deny' },
        ]);
        expect(result).toBe('allow');
    });

    it('returns first option when multiple options present', async () => {
        const result = await selectPrompt([
            { label: 'Option A', value: 'a', hint: 'first option' },
            { label: 'Option B', value: 'b', hint: 'second option' },
            { label: 'Option C', value: 'c', hint: 'third option' },
        ]);
        expect(result).toBe('a');
    });

    it('returns empty string for empty options in non-TTY', async () => {
        const result = await selectPrompt([]);
        expect(result).toBe('');
    });
});
