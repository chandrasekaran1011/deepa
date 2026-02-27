// ─── File edit tool (search-and-replace) ───

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolvePath } from './resolve-path.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    path: z.string().describe('Path to the file to edit'),
    search: z.string().describe('Exact text to search for (must be unique in the file unless replaceAll is true)'),
    replace: z.string().describe('Replacement text'),
    replaceAll: z.boolean().optional().default(false).describe('Replace all occurrences (required when multiple matches exist)'),
});

/** Return a few lines of context around the first occurrence of `needle` in `lines`. */
function getContext(lines: string[], needle: string, contextLines = 3): string {
    const joined = lines.join('\n');
    const idx = joined.indexOf(needle);
    if (idx < 0) return '';

    // Find which line the match starts on
    const before = joined.slice(0, idx);
    const matchStartLine = before.split('\n').length - 1;
    const matchEndLine = matchStartLine + needle.split('\n').length - 1;

    const start = Math.max(0, matchStartLine - contextLines);
    const end = Math.min(lines.length - 1, matchEndLine + contextLines);

    return lines
        .slice(start, end + 1)
        .map((l, i) => `${start + i + 1}: ${l}`)
        .join('\n');
}

export const fileEditTool: Tool = {
    name: 'file_edit',
    description: 'Edit a file by replacing exact text matches. The search text must be unique in the file (to prevent wrong-location edits). If multiple matches exist, either provide more surrounding context to make it unique, or set replaceAll: true.',
    parameters,
    riskLevel: 'medium',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { path: filePath, search, replace, replaceAll } = params as z.infer<typeof parameters>;
        const absPath = resolvePath(filePath, context.cwd);

        if (!existsSync(absPath)) {
            return { content: `Error: File not found: ${absPath}`, isError: true };
        }

        let content = readFileSync(absPath, 'utf-8');
        const occurrences = content.split(search).length - 1;

        if (occurrences === 0) {
            return {
                content: `Error: Search text not found in ${absPath}.\n\nSearch text:\n${search}`,
                isError: true,
            };
        }

        // Uniqueness check: reject ambiguous single replacements (Claude Code pattern)
        if (!replaceAll && occurrences > 1) {
            return {
                content: `Error: Found ${occurrences} occurrences of the search text in ${absPath}. ` +
                    `The match must be unique to prevent editing the wrong location. ` +
                    `Either include more surrounding context in your search string to make it unique, ` +
                    `or set replaceAll: true to replace all ${occurrences} occurrences.`,
                isError: true,
            };
        }

        if (replaceAll) {
            content = content.replaceAll(search, replace);
        } else {
            content = content.replace(search, replace);
        }

        writeFileSync(absPath, content, 'utf-8');

        // Show context around the replacement so the LLM can verify
        const newLines = content.split('\n');
        const contextSnippet = getContext(newLines, replace);
        const contextBlock = contextSnippet ? `\n\nContext after edit:\n${contextSnippet}` : '';

        return {
            content: `Edited ${absPath}: replaced ${replaceAll ? occurrences : 1} occurrence(s)${contextBlock}`,
        };
    },
};
