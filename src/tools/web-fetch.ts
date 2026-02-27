// ─── Web fetch tool ───

import { z } from 'zod';
import TurndownService from 'turndown';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    url: z.string().url().describe('URL to fetch'),
    maxLength: z.number().optional().default(8000).describe('Max content length in characters'),
});

const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
});

export const webFetchTool: Tool = {
    name: 'web_fetch',
    description: 'Fetch content from a URL and convert HTML to markdown. Useful for reading documentation, APIs, and web pages.',
    parameters,
    riskLevel: 'low',

    async execute(params: unknown, _context: ToolContext): Promise<ToolResult> {
        const { url, maxLength } = params as z.infer<typeof parameters>;

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Deepa-CLI/0.1 (AI Coding Agent)',
                    Accept: 'text/html,application/xhtml+xml,text/plain,application/json',
                },
                redirect: 'follow',
            });

            if (!response.ok) {
                return {
                    content: `Error: HTTP ${response.status} ${response.statusText} for ${url}`,
                    isError: true,
                };
            }

            const contentType = response.headers.get('content-type') || '';
            const body = await response.text();

            let text: string;
            if (contentType.includes('html')) {
                text = turndown.turndown(body);
            } else if (contentType.includes('json')) {
                try {
                    text = '```json\n' + JSON.stringify(JSON.parse(body), null, 2) + '\n```';
                } catch {
                    text = body;
                }
            } else {
                text = body;
            }

            if (text.length > maxLength) {
                text = text.slice(0, maxLength) + `\n\n... (truncated, ${text.length - maxLength} chars omitted)`;
            }

            return { content: `Content from ${url}:\n\n${text}` };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            return { content: `Error fetching ${url}: ${error}`, isError: true };
        }
    },
};
