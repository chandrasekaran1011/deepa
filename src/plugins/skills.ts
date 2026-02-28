// ─── Skills loader ───
// Progressive disclosure: only metadata (name + description) loaded at startup.
// Full SKILL.md body read from filesystem on demand when use_skill is called.

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ────────────────── Validation ──────────────────

const NAME_MAX = 64;
const NAME_PATTERN = /^[a-z0-9-]+$/;
const RESERVED_WORDS = ['anthropic', 'claude'];
const DESCRIPTION_MAX = 1024;

export interface SkillValidationError {
    field: string;
    message: string;
}

/** Validate frontmatter per Claude skill best practices */
export function validateFrontmatter(fm: Record<string, string>, fallbackName: string): SkillValidationError[] {
    const errors: SkillValidationError[] = [];
    const name = fm.name || fallbackName;

    // Name validation
    if (name.length > NAME_MAX) {
        errors.push({ field: 'name', message: `Name "${name}" exceeds ${NAME_MAX} characters (got ${name.length})` });
    }
    if (!NAME_PATTERN.test(name)) {
        errors.push({ field: 'name', message: `Name "${name}" must contain only lowercase letters, numbers, and hyphens` });
    }
    if (name.includes('<') || name.includes('>')) {
        errors.push({ field: 'name', message: `Name "${name}" must not contain XML tags` });
    }
    for (const word of RESERVED_WORDS) {
        if (name.includes(word)) {
            errors.push({ field: 'name', message: `Name "${name}" must not contain reserved word "${word}"` });
        }
    }

    // Description validation
    const desc = fm.description || '';
    if (!desc) {
        errors.push({ field: 'description', message: 'Description is required but missing' });
    }
    if (desc.length > DESCRIPTION_MAX) {
        errors.push({ field: 'description', message: `Description exceeds ${DESCRIPTION_MAX} characters (got ${desc.length})` });
    }
    if (desc.includes('<') && desc.includes('>')) {
        errors.push({ field: 'description', message: 'Description must not contain XML tags' });
    }

    return errors;
}

// ────────────────── Skill Interface ──────────────────

export interface Skill {
    name: string;
    description: string;
    path: string;                // Absolute path to SKILL.md
    dir: string;                 // Absolute path to the skill directory
    allowedTools?: string[];     // Optional tool whitelist for this skill
}

// ────────────────── Registry ──────────────────

/** In-memory skill registry — metadata only, body read on demand */
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

    /** Get short descriptions for system prompt (progressive disclosure — no full instructions) */
    getDescriptions(): string[] {
        return this.list().map((s) => `${s.name}: ${s.description}`);
    }

    get size(): number {
        return this.skills.size;
    }
}

// ────────────────── Reading (on demand) ──────────────────

/**
 * Read a skill's full SKILL.md body from the filesystem.
 * Called at execution time, not at startup.
 */
export function readSkillBody(skill: Skill): string {
    if (!existsSync(skill.path)) {
        return `Error: SKILL.md not found at ${skill.path}`;
    }
    const content = readFileSync(skill.path, 'utf-8');
    const { body } = parseFrontmatter(content);
    return body;
}

/**
 * Read a referenced file within the skill directory.
 * Supports progressive disclosure — SKILL.md can reference FORMS.md, REFERENCE.md, etc.
 * Returns the file content, or an error message if not found.
 * Only allows reading files within the skill's directory (no path traversal).
 */
export function readSkillFile(skill: Skill, relativePath: string): string {
    // Prevent path traversal
    const resolved = join(skill.dir, relativePath);
    if (!resolved.startsWith(skill.dir)) {
        return `Error: Path "${relativePath}" escapes the skill directory`;
    }
    if (!existsSync(resolved)) {
        // List available files to help the LLM
        const available = listSkillFiles(skill.dir);
        return `Error: File "${relativePath}" not found in skill directory.\nAvailable files:\n${available.map(f => `  - ${f}`).join('\n')}`;
    }
    const stat = statSync(resolved);
    if (stat.isDirectory()) {
        const contents = listSkillFiles(resolved);
        return `Directory "${relativePath}" contains:\n${contents.map(f => `  - ${f}`).join('\n')}`;
    }
    if (stat.size > 5 * 1024 * 1024) {
        return `Error: File "${relativePath}" is too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, max 5MB)`;
    }
    return readFileSync(resolved, 'utf-8');
}

/** List files in a skill directory (non-recursive, one level deep) */
function listSkillFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
            files.push(`${entry.name}/`);
        } else {
            files.push(entry.name);
        }
    }
    return files;
}

// ────────────────── Loader ──────────────────

/**
 * Load skill metadata from global and project skill directories.
 * Only reads frontmatter (name, description, allowed-tools).
 * SKILL.md body is NOT loaded — it's read on demand via readSkillBody().
 *
 * Directories searched (in order, last-wins for duplicate names):
 *   1. ~/.deepa/skills/
 *   2. ~/.agents/skills/
 *   3. <cwd>/.deepa/skills/
 *   4. <cwd>/.agents/skills/
 */
export function loadSkills(cwd: string, overrideDirs?: string[]): SkillRegistry {
    const registry = new SkillRegistry();

    const dirs = overrideDirs ?? [
        join(homedir(), '.deepa', 'skills'),
        join(homedir(), '.agents', 'skills'),
        join(cwd, '.deepa', 'skills'),
        join(cwd, '.agents', 'skills'),
    ];

    for (const dir of dirs) {
        if (!existsSync(dir)) continue;

        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            let isDir = entry.isDirectory();
            if (entry.isSymbolicLink()) {
                try {
                    const stat = statSync(join(dir, entry.name));
                    isDir = stat.isDirectory();
                } catch {
                    continue;
                }
            }
            if (!isDir) continue;

            const skillDir = join(dir, entry.name);
            const skillMdPath = join(skillDir, 'SKILL.md');
            if (!existsSync(skillMdPath)) continue;

            const stats = statSync(skillMdPath);
            if (stats.size > 10 * 1024 * 1024) continue;

            // Only read frontmatter at startup — body is lazy-loaded
            const content = readFileSync(skillMdPath, 'utf-8');
            const { frontmatter } = parseFrontmatter(content);

            // Validate frontmatter
            const validationErrors = validateFrontmatter(frontmatter, entry.name);
            if (validationErrors.length > 0) {
                // Log warnings but still load with fallbacks
                for (const err of validationErrors) {
                    process.stderr.write(`[skills] Warning: ${entry.name}: ${err.message}\n`);
                }
            }

            const allowedTools = frontmatter['allowed-tools']
                ? frontmatter['allowed-tools'].split(',').map((t) => t.trim()).filter(Boolean)
                : undefined;

            const name = frontmatter.name || entry.name;

            registry.add({
                name,
                description: frontmatter.description || '',
                path: skillMdPath,
                dir: skillDir,
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
