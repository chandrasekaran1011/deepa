// ─── Tests for input history module ───

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We test the pure functions directly by re-implementing the logic
// since the module uses hardcoded paths. We test appendToHistory directly.
import { appendToHistory } from '../../src/ui/history.js';

const TEST_DIR = join(tmpdir(), 'deepa-test-history-' + Date.now());

describe('Input History', () => {
    beforeEach(() => {
        if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    });

    afterEach(() => {
        // Cleanup
        try {
            const files = require('fs').readdirSync(TEST_DIR);
            for (const f of files) unlinkSync(join(TEST_DIR, f));
            require('fs').rmdirSync(TEST_DIR);
        } catch { /* ignore */ }
    });

    // ─── appendToHistory ───

    it('appends a new entry to empty history', () => {
        const result = appendToHistory([], 'hello');
        expect(result).toEqual(['hello']);
    });

    it('appends to existing history', () => {
        const result = appendToHistory(['first'], 'second');
        expect(result).toEqual(['first', 'second']);
    });

    it('trims whitespace from input', () => {
        const result = appendToHistory([], '  hello  ');
        expect(result).toEqual(['hello']);
    });

    it('ignores empty strings', () => {
        const result = appendToHistory(['existing'], '');
        expect(result).toEqual(['existing']);
    });

    it('ignores whitespace-only strings', () => {
        const result = appendToHistory(['existing'], '   ');
        expect(result).toEqual(['existing']);
    });

    it('deduplicates consecutive identical entries', () => {
        const result = appendToHistory(['hello'], 'hello');
        expect(result).toEqual(['hello']);
    });

    it('allows non-consecutive duplicates', () => {
        const result = appendToHistory(['hello', 'world'], 'hello');
        expect(result).toEqual(['hello', 'world', 'hello']);
    });

    it('caps history at 500 entries', () => {
        const history = Array.from({ length: 500 }, (_, i) => `entry-${i}`);
        const result = appendToHistory(history, 'new-entry');
        expect(result).toHaveLength(500);
        expect(result[0]).toBe('entry-1'); // first entry dropped
        expect(result[499]).toBe('new-entry'); // new entry at end
    });

    it('handles special characters in input', () => {
        const result = appendToHistory([], 'git commit -m "feat: add thing"');
        expect(result).toEqual(['git commit -m "feat: add thing"']);
    });

    it('handles multi-line input (treats as single entry)', () => {
        const result = appendToHistory([], 'line1\nline2');
        expect(result).toEqual(['line1\nline2']);
    });

    it('preserves order of history', () => {
        let history: string[] = [];
        history = appendToHistory(history, 'first');
        history = appendToHistory(history, 'second');
        history = appendToHistory(history, 'third');
        expect(history).toEqual(['first', 'second', 'third']);
    });
});
