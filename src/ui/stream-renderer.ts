// ─── Streaming markdown renderer ───
// Buffers streamed text, renders completed lines with markdown formatting.
// Tracks code block state across chunks for proper fenced code rendering.

import chalk from 'chalk';
import { C } from './renderer.js';

/**
 * Render a single line of markdown to styled terminal output.
 */
function renderLine(line: string): string {
    // Headers
    if (line.startsWith('### ')) return '   ' + chalk.bold.cyan(line.slice(4));
    if (line.startsWith('## ')) return '  ' + chalk.bold.blue(line.slice(3));
    if (line.startsWith('# ')) return ' ' + chalk.bold.magenta(line.slice(2));

    // Horizontal rule
    if (/^---+$/.test(line.trim())) return C.muted('  ' + '─'.repeat(50));

    // Bullet lists
    if (/^\s*[-*] /.test(line)) {
        const indent = line.match(/^(\s*)/)?.[1] ?? '';
        const text = line.replace(/^\s*[-*] /, '');
        return indent + C.muted('  • ') + applyInline(text);
    }

    // Numbered lists
    if (/^\s*\d+\. /.test(line)) {
        const match = line.match(/^(\s*)(\d+)\. (.*)$/);
        if (match) {
            return match[1] + C.muted(`  ${match[2]}. `) + applyInline(match[3]);
        }
    }

    // Blockquote
    if (line.startsWith('> ')) {
        return C.muted('  │ ') + chalk.italic(applyInline(line.slice(2)));
    }

    // Regular text with inline formatting
    return applyInline(line);
}

/**
 * Apply inline markdown formatting (bold, italic, code).
 */
function applyInline(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
        .replace(/(?<!\*)\*(.+?)\*(?!\*)/g, (_, t) => chalk.italic(t))
        .replace(/`([^`]+)`/g, (_, t) => C.accent(t));
}

/**
 * Streaming markdown renderer.
 * Feed it chunks of text as they arrive from the LLM.
 * It buffers until complete lines are available, then renders them.
 */
export class StreamingMarkdownRenderer {
    private buffer = '';
    private inCodeBlock = false;
    private codeBlockLang = '';

    /**
     * Feed a chunk of streamed text.
     * Returns rendered string to write to stdout (may be empty if buffering).
     */
    feed(chunk: string): string {
        this.buffer += chunk;
        let output = '';

        // Process complete lines (keep the last incomplete line in buffer)
        while (this.buffer.includes('\n')) {
            const nlIndex = this.buffer.indexOf('\n');
            const line = this.buffer.slice(0, nlIndex);
            this.buffer = this.buffer.slice(nlIndex + 1);
            output += this.processLine(line) + '\n';
        }

        return output;
    }

    /**
     * Flush any remaining buffered content (call when the stream ends).
     */
    flush(): string {
        let output = '';

        // Process any remaining buffered text
        if (this.buffer) {
            output += this.processLine(this.buffer) + '\n';
            this.buffer = '';
        }

        // Close any unclosed code block
        if (this.inCodeBlock) {
            this.inCodeBlock = false;
            output += C.muted('  └' + '─'.repeat(58)) + '\n';
        }

        return output;
    }

    private processLine(line: string): string {
        // Code fence detection
        const fenceMatch = line.match(/^```(\w*)/);
        if (fenceMatch) {
            if (!this.inCodeBlock) {
                this.inCodeBlock = true;
                this.codeBlockLang = fenceMatch[1] || '';
                const langLabel = this.codeBlockLang ? ` ${this.codeBlockLang} ` : '';
                return C.muted('  ┌' + '─'.repeat(4)) + (langLabel ? C.accent(langLabel) : '') + C.muted('─'.repeat(Math.max(0, 54 - langLabel.length)));
            } else {
                this.inCodeBlock = false;
                this.codeBlockLang = '';
                return C.muted('  └' + '─'.repeat(58));
            }
        }

        if (this.inCodeBlock) {
            return C.muted('  │ ') + C.accent(line);
        }

        return renderLine(line);
    }
}
