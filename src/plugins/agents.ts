// ─── Agent registry loader ───
// Agents are markdown files with YAML frontmatter stored in .deepa/agents/ or ~/.deepa/agents/.
// Progressive disclosure: only metadata loaded at startup; full prompt read on demand.

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parseFrontmatter } from './skills.js';

// ────────────────── Tool Categories ──────────────────

/** Shorthand tool categories → concrete deepa tool names */
export const TOOL_CATEGORIES: Record<string, string[]> = {
    'read-only': ['file_read', 'file_list', 'search_grep', 'search_files'],
    'write': ['file_write', 'file_edit'],
    'shell': ['shell'],
    'web': ['web_fetch', 'web_search'],
    'all': [], // empty = no restriction → all tools allowed
};

/** Resolve tool category / explicit list → concrete tool name array (or undefined = all) */
export function resolveTools(toolsValue: string | undefined): string[] | undefined {
    if (!toolsValue || toolsValue.trim() === 'all') return undefined; // no restriction

    // Check if it's a single category keyword
    const trimmed = toolsValue.trim();
    if (TOOL_CATEGORIES[trimmed]) {
        return TOOL_CATEGORIES[trimmed];
    }

    // Parse comma-separated list (may include category keywords)
    const entries = trimmed.split(',').map((t) => t.trim()).filter(Boolean);
    const resolved: string[] = [];
    for (const entry of entries) {
        if (TOOL_CATEGORIES[entry]) {
            resolved.push(...TOOL_CATEGORIES[entry]);
        } else {
            resolved.push(entry);
        }
    }
    return [...new Set(resolved)]; // deduplicate
}

// ────────────────── Agent Interface ──────────────────

export interface Agent {
    name: string;
    description: string;
    path: string;       // Absolute path to the .md file
    dir: string;        // Parent directory
    model: string;      // 'inherit' or a stored model name
    tools?: string[];   // undefined = all tools; array = allowed tool names
    maxTurns: number;
}

// ────────────────── Registry ──────────────────

export class AgentRegistry {
    private agents = new Map<string, Agent>();

    add(agent: Agent): void {
        this.agents.set(agent.name, agent);
    }

    get(name: string): Agent | undefined {
        return this.agents.get(name);
    }

    list(): Agent[] {
        return Array.from(this.agents.values());
    }

    /** Short descriptions for system prompt injection */
    getDescriptions(): string[] {
        return this.list().map((a) => `- ${a.name}: ${a.description}`);
    }

    get size(): number {
        return this.agents.size;
    }
}

// ────────────────── Read body on demand ──────────────────

/** Read the full agent prompt body (everything after frontmatter). */
export function readAgentBody(agent: Agent): string {
    if (!existsSync(agent.path)) {
        return `Error: Agent file not found at ${agent.path}`;
    }
    const content = readFileSync(agent.path, 'utf-8');
    const { body } = parseFrontmatter(content);
    return body;
}

// ────────────────── Loader ──────────────────

/**
 * Load all agents from global and project agent directories.
 * Search order (last-wins for duplicate names):
 *   1. ~/.deepa/agents/
 *   2. <cwd>/.deepa/agents/
 */
export function loadAgents(cwd: string, overrideDirs?: string[]): AgentRegistry {
    const registry = new AgentRegistry();

    const dirs = overrideDirs ?? [
        join(homedir(), '.deepa', 'agents'),
        join(cwd, '.deepa', 'agents'),
    ];

    for (const dir of dirs) {
        if (!existsSync(dir)) continue;

        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            // Support both <name>.md files and <name>/ directories with an AGENT.md inside
            let agentPath: string;
            let agentDir: string;

            if (entry.isFile() && entry.name.endsWith('.md')) {
                agentPath = join(dir, entry.name);
                agentDir = dir;
            } else if (entry.isDirectory()) {
                const nested = join(dir, entry.name, 'AGENT.md');
                if (!existsSync(nested)) continue;
                agentPath = nested;
                agentDir = join(dir, entry.name);
            } else {
                continue;
            }

            try {
                const stat = statSync(agentPath);
                if (stat.size > 1024 * 1024) continue; // skip files > 1MB

                const content = readFileSync(agentPath, 'utf-8');
                const { frontmatter } = parseFrontmatter(content);

                const fallbackName = entry.name.replace(/\.md$/, '');
                const name = (frontmatter.name || fallbackName)
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '-');

                const description = frontmatter.description || '';
                if (!description) {
                    process.stderr.write(`[agents] Warning: ${entry.name}: missing description, skipping\n`);
                    continue;
                }

                const model = frontmatter.model?.trim() || 'inherit';
                const tools = resolveTools(frontmatter.tools);
                const maxTurns = frontmatter['max-turns'] || frontmatter.maxTurns
                    ? parseInt(frontmatter['max-turns'] || frontmatter.maxTurns, 10)
                    : 30;

                registry.add({
                    name,
                    description,
                    path: agentPath,
                    dir: agentDir,
                    model,
                    tools,
                    maxTurns: isNaN(maxTurns) ? 30 : maxTurns,
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`[agents] Warning: failed to load ${entry.name}: ${msg}\n`);
            }
        }
    }

    return registry;
}
