// ─── Skills loader ───
// Progressive disclosure: descriptions loaded at startup, full instructions read on demand.

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Skill {
    name: string;
    description: string;
    instructions: string;        // Full SKILL.md body (read on demand)
    path: string;                // Absolute path to SKILL.md
    trigger?: string;            // Optional regex/keyword pattern for auto-matching
    allowedTools?: string[];     // Optional tool whitelist for this skill
}

/** In-memory skill registry — populated at startup, queried by use_skill tool */
export class SkillRegistry {
    private skills = new Map<string, Skill>();

    add(skill: Skill): void {
        this.skills.set(skill.name, skill);
    }

    get(name: string): Skill | undefined {
        return this.skills.get(name);
    }

    list(): Skill[] {
        return Array.from(this.skills.values());
    }

    /** Return skills whose trigger pattern matches the given text */
    match(text: string): Skill[] {
        const lower = text.toLowerCase();
        return this.list().filter((s) => {
            if (!s.trigger) return false;
            try {
                return new RegExp(s.trigger, 'i').test(lower);
            } catch {
                // Fallback: simple substring match if trigger isn't valid regex
                return lower.includes(s.trigger.toLowerCase());
            }
        });
    }

    /** Get short descriptions for system prompt (progressive disclosure — no full instructions) */
    getDescriptions(): string[] {
        return this.list().map((s) => `${s.name}: ${s.description}`);
    }

    get size(): number {
        return this.skills.size;
    }
}

/**
 * Load SKILL.md files from global and project skill directories.
 * Returns a SkillRegistry for on-demand access.
 *
 * Directories searched (in order, last-wins for duplicate names):
 *   1. ~/.deepa/skills/
 *   2. <cwd>/.deepa/skills/
 *   3. <cwd>/.agents/skills/
 */
export function loadSkills(cwd: string, overrideDirs?: string[]): SkillRegistry {
    const registry = new SkillRegistry();

    const dirs = overrideDirs ?? [
        join(homedir(), '.deepa', 'skills'),
        join(cwd, '.deepa', 'skills'),
        join(cwd, '.agents', 'skills'),
    ];

    for (const dir of dirs) {
        if (!existsSync(dir)) continue;

        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillMdPath = join(dir, entry.name, 'SKILL.md');
            if (!existsSync(skillMdPath)) continue;

            // Guard against extremely large skill files (>10MB per LangChain spec)
            const stats = statSync(skillMdPath);
            if (stats.size > 10 * 1024 * 1024) continue;

            const content = readFileSync(skillMdPath, 'utf-8');
            const { frontmatter, body } = parseFrontmatter(content);

            const allowedTools = frontmatter['allowed-tools']
                ? frontmatter['allowed-tools'].split(',').map((t) => t.trim()).filter(Boolean)
                : undefined;

            registry.add({
                name: frontmatter.name || entry.name,
                description: frontmatter.description || '',
                instructions: body,
                path: skillMdPath,
                trigger: frontmatter.trigger || undefined,
                allowedTools,
            });
        }
    }

    return registry;
}

// ────────────────── Frontmatter Parser ──────────────────

export function parseFrontmatter(content: string): {
    frontmatter: Record<string, string>;
    body: string;
} {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
        return { frontmatter: {}, body: content };
    }

    const frontmatter: Record<string, string> = {};
    const lines = match[1].split('\n');
    for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim();
            const value = line.slice(colonIdx + 1).trim();
            frontmatter[key] = value;
        }
    }

    return { frontmatter, body: match[2].trim() };
}
