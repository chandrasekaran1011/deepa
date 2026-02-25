// ─── Skills loader ───

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Skill {
    name: string;
    description: string;
    instructions: string;
    path: string;
}

/**
 * Load SKILL.md files from global and project skill directories.
 */
export function loadSkills(cwd: string): Skill[] {
    const skills: Skill[] = [];
    const dirs = [
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

            const content = readFileSync(skillMdPath, 'utf-8');
            const { frontmatter, body } = parseFrontmatter(content);

            skills.push({
                name: frontmatter.name || entry.name,
                description: frontmatter.description || '',
                instructions: body,
                path: skillMdPath,
            });
        }
    }

    return skills;
}

function parseFrontmatter(content: string): {
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
