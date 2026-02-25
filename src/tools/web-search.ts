// ─── Web search tool ───
// Uses DuckDuckGo Instant Answer JSON API (no API key required)
// Falls back to DuckDuckGo HTML lite if JSON API returns nothing useful.

import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

export const webSearchTool: Tool = {
    name: 'web_search',
    description: 'Search the web for current information. Returns search result titles, snippets, and URLs. Use this when you need to find up-to-date information, research topics, or answer questions about current events.',
    parameters: z.object({
        query: z.string().describe('The search query'),
        maxResults: z.number().optional().describe('Max results to return (default 8)'),
    }),
    safetyLevel: 'safe',

    async execute(params: unknown, _context: ToolContext): Promise<ToolResult> {
        const { query, maxResults = 8 } = params as { query: string; maxResults?: number };

        // ── Strategy 1: DuckDuckGo Instant Answer JSON API ──
        try {
            const encodedQuery = encodeURIComponent(query);
            const jsonUrl = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

            const jsonRes = await fetch(jsonUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; DeepaAgent/1.0)',
                    Accept: 'application/json',
                },
                signal: AbortSignal.timeout(8_000),
            });

            if (jsonRes.ok) {
                const data = await jsonRes.json() as DDGJsonResponse;
                const results = extractDDGJsonResults(data, maxResults);

                if (results.length > 0) {
                    const formatted = results
                        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`)
                        .join('\n\n');
                    return { content: `Search results for "${query}":\n\n${formatted}` };
                }

                // If JSON API had an abstract/answer but no links, return that
                if (data.AbstractText) {
                    return {
                        content: `Search result for "${query}":\n\n${data.AbstractText}\nSource: ${data.AbstractURL}`,
                    };
                }
            }
        } catch {
            // fall through to HTML fallback
        }

        // ── Strategy 2: DuckDuckGo HTML lite (fallback) ──
        try {
            const encodedQuery = encodeURIComponent(query);
            const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

            const htmlRes = await fetch(htmlUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                signal: AbortSignal.timeout(10_000),
            });

            if (!htmlRes.ok) {
                return { content: `Search failed: HTTP ${htmlRes.status}`, isError: true };
            }

            const html = await htmlRes.text();
            const results = parseHtmlResults(html, maxResults);

            if (results.length === 0) {
                return { content: `No search results found for: "${query}". Try rephrasing your query.` };
            }

            const formatted = results
                .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`)
                .join('\n\n');

            return { content: `Search results for "${query}":\n\n${formatted}` };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                content: `Search unavailable: ${msg}. You can still answer from your training knowledge or ask the user to provide a URL to fetch directly.`,
                isError: true,
            };
        }
    },
};

// ─── DDG JSON API types ────────────────────────────────────

interface DDGRelatedTopic {
    Text?: string;
    FirstURL?: string;
    Name?: string;
    Topics?: DDGRelatedTopic[];
}

interface DDGJsonResponse {
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: DDGRelatedTopic[];
    Results?: Array<{ Text?: string; FirstURL?: string }>;
}

function extractDDGJsonResults(data: DDGJsonResponse, max: number): Array<{ title: string; snippet: string; url: string }> {
    const results: Array<{ title: string; snippet: string; url: string }> = [];

    // Top-level Results (rare but highest quality)
    for (const r of data.Results ?? []) {
        if (!r.FirstURL || !r.Text) continue;
        const [title, ...rest] = r.Text.split(' - ');
        results.push({ title: title?.trim() ?? r.Text, snippet: rest.join(' - ').trim(), url: r.FirstURL });
        if (results.length >= max) return results;
    }

    // RelatedTopics — flatten nested Topics
    const flat: DDGRelatedTopic[] = [];
    for (const t of data.RelatedTopics ?? []) {
        if (t.Topics) flat.push(...t.Topics);
        else flat.push(t);
    }

    for (const t of flat) {
        if (!t.FirstURL || !t.Text) continue;
        const [title, ...rest] = t.Text.split(' - ');
        results.push({ title: title?.trim() ?? t.Text, snippet: rest.join(' - ').trim(), url: t.FirstURL });
        if (results.length >= max) break;
    }

    return results;
}

// ─── HTML fallback parser ──────────────────────────────────

interface SearchResult { title: string; snippet: string; url: string }

function parseHtmlResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        const url = decodeUrl(match[1]);
        const title = stripHtml(match[2]).trim();
        const snippet = stripHtml(match[3]).trim();
        if (title && url && !url.startsWith('/')) results.push({ title, snippet, url });
    }

    if (results.length === 0) {
        const simpleLinkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
        while ((match = simpleLinkRegex.exec(html)) !== null && results.length < maxResults) {
            const url = decodeUrl(match[1]);
            const title = stripHtml(match[2]).trim();
            if (title && url && !url.startsWith('/')) results.push({ title, snippet: '', url });
        }
    }

    return results;
}

function decodeUrl(raw: string): string {
    try {
        return decodeURIComponent(
            raw.replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').replace(/&rut=.*$/, ''),
        );
    } catch {
        return raw;
    }
}

function stripHtml(html: string): string {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ').trim();
}
