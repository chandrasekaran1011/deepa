// ─── Tests for streaming markdown renderer ───

import { describe, it, expect, beforeEach } from 'vitest';
import { StreamingMarkdownRenderer } from '../../src/ui/stream-renderer.js';

// Strip ANSI escape codes for assertion matching
function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('StreamingMarkdownRenderer', () => {
    let renderer: StreamingMarkdownRenderer;

    beforeEach(() => {
        renderer = new StreamingMarkdownRenderer();
    });

    // ─── Basic text ───

    it('buffers incomplete lines', () => {
        const output = renderer.feed('hello');
        expect(output).toBe(''); // no newline yet, stays buffered
    });

    it('renders complete lines', () => {
        const output = renderer.feed('hello\n');
        expect(stripAnsi(output)).toContain('hello');
    });

    it('handles multiple lines in one chunk', () => {
        const output = renderer.feed('line1\nline2\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('line1');
        expect(plain).toContain('line2');
    });

    it('flushes remaining buffer', () => {
        renderer.feed('partial');
        const output = renderer.flush();
        expect(stripAnsi(output)).toContain('partial');
    });

    it('flush returns empty when buffer is empty', () => {
        expect(renderer.flush()).toBe('');
    });

    // ─── Headers ───

    it('renders h1 headers', () => {
        const output = renderer.feed('# My Title\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('My Title');
        expect(plain).not.toContain('# '); // hash should be stripped
    });

    it('renders h2 headers', () => {
        const output = renderer.feed('## Section\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('Section');
        expect(plain).not.toContain('## ');
    });

    it('renders h3 headers', () => {
        const output = renderer.feed('### Subsection\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('Subsection');
        expect(plain).not.toContain('### ');
    });

    // ─── Inline formatting ───

    it('renders bold text', () => {
        const output = renderer.feed('This is **bold** text\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('bold');
        expect(plain).not.toContain('**');
    });

    it('renders italic text', () => {
        const output = renderer.feed('This is *italic* text\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('italic');
    });

    it('renders inline code', () => {
        const output = renderer.feed('Use `console.log()` here\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('console.log()');
        expect(plain).not.toContain('`');
    });

    // ─── Lists ───

    it('renders bullet lists with dash', () => {
        const output = renderer.feed('- Item one\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('•');
        expect(plain).toContain('Item one');
    });

    it('renders bullet lists with asterisk', () => {
        const output = renderer.feed('* Item two\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('•');
        expect(plain).toContain('Item two');
    });

    it('renders numbered lists', () => {
        const output = renderer.feed('1. First\n2. Second\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('1.');
        expect(plain).toContain('First');
        expect(plain).toContain('2.');
        expect(plain).toContain('Second');
    });

    // ─── Blockquotes ───

    it('renders blockquotes', () => {
        const output = renderer.feed('> This is a quote\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('│');
        expect(plain).toContain('This is a quote');
    });

    // ─── Horizontal rules ───

    it('renders horizontal rules', () => {
        const output = renderer.feed('---\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('─');
    });

    // ─── Code blocks ───

    it('renders code block fences', () => {
        const output = renderer.feed('```javascript\nconsole.log("hi");\n```\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('┌');
        expect(plain).toContain('javascript');
        expect(plain).toContain('console.log("hi");');
        expect(plain).toContain('└');
    });

    it('renders code blocks without language', () => {
        const output = renderer.feed('```\nsome code\n```\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('┌');
        expect(plain).toContain('some code');
        expect(plain).toContain('└');
    });

    it('handles code blocks spanning multiple feed calls', () => {
        let output = '';
        output += renderer.feed('```python\n');
        output += renderer.feed('def hello():\n');
        output += renderer.feed('    print("hi")\n');
        output += renderer.feed('```\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('python');
        expect(plain).toContain('def hello():');
        expect(plain).toContain('print("hi")');
        expect(plain).toContain('┌');
        expect(plain).toContain('└');
    });

    it('does not apply markdown formatting inside code blocks', () => {
        const output = renderer.feed('```\n**not bold** # not header\n```\n');
        const plain = stripAnsi(output);
        // Inside code block, ** and # should be kept as-is
        expect(plain).toContain('**not bold**');
        expect(plain).toContain('# not header');
    });

    it('flush closes unclosed code blocks', () => {
        renderer.feed('```\ncode line\n');
        const output = renderer.flush();
        const plain = stripAnsi(output);
        // Should have closing fence
        expect(plain).toContain('└');
    });

    // ─── Streaming simulation ───

    it('handles character-by-character streaming', () => {
        let output = '';
        const text = 'Hello **world**\n';
        for (const char of text) {
            output += renderer.feed(char);
        }
        const plain = stripAnsi(output);
        expect(plain).toContain('Hello');
        expect(plain).toContain('world');
    });

    it('handles mixed content across chunks', () => {
        let output = '';
        output += renderer.feed('# Title\n\nSome text with **bold** and `code`.\n');
        output += renderer.feed('\n- List item 1\n- List item 2\n');
        output += renderer.feed('\n```\ncode block\n```\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('Title');
        expect(plain).toContain('bold');
        expect(plain).toContain('code');
        expect(plain).toContain('•');
        expect(plain).toContain('List item 1');
        expect(plain).toContain('┌');
        expect(plain).toContain('code block');
    });

    it('handles empty lines', () => {
        const output = renderer.feed('before\n\nafter\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('before');
        expect(plain).toContain('after');
    });

    // ─── Edge cases ───

    it('handles empty feed', () => {
        expect(renderer.feed('')).toBe('');
    });

    it('handles only newlines', () => {
        const output = renderer.feed('\n\n\n');
        expect(output).toBeDefined();
    });

    it('handles bold and code on the same line', () => {
        const output = renderer.feed('Use **`fetch`** for API calls\n');
        const plain = stripAnsi(output);
        expect(plain).toContain('fetch');
        expect(plain).toContain('API calls');
    });
});
