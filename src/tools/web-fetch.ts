// ─── Web fetch tool ───

import { z } from 'zod';
import TurndownService from 'turndown';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    url: z.string().url().describe('URL to fetch'),
    maxLength: z.number().optional().default(8000).describe('Max raw content length in characters (if not using extractionPrompt)'),
    extractionPrompt: z.string().optional().describe('If passed, the entire page will be read by a sub-agent to answer this prompt, saving tokens and allowing extraction from huge pages. Example: "Extract the API rate limits."'),
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

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { url, maxLength, extractionPrompt } = params as z.infer<typeof parameters>;

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

            if (extractionPrompt && context.askSubagent) {
                // If it's a huge page and we have a prompt, let the subagent process it so we save orchestrator tokens!
                context.log(`[web_fetch] Passing ${text.length} chars to subagent to extract: "${extractionPrompt}"`);
                const extractedText = await context.askSubagent(extractionPrompt, text.slice(0, 100000)); // Cap to 100k to protect subagent window
                return { content: `Extracted from ${url}:\n\n${extractedText}` };
            }

            if (text.length > maxLength) {
                 try {
                     const tmpDir = join(tmpdir(), '.deepa', 'tmp');
                     if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
                     const tmpFile = join(tmpDir, `page_${Date.now()}.md`);
                     writeFileSync(tmpFile, text, 'utf-8');
                     
                     text = text.slice(0, maxLength) + `\n\n... [Page truncated. Full markdown saved to ${tmpFile}. Use file_read to read it if needed.]`;
                 } catch (e) {
                     text = text.slice(0, maxLength) + `\n\n... (truncated, ${text.length - maxLength} chars omitted)`;
                 }
            }

            return { content: `Content from ${url}:\n\n${text}` };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            return { content: `Error fetching ${url}: ${error}`, isError: true };
        }
    },
};
