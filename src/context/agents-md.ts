// ─── AGENTS.md / CLAUDE.md loader ───

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CONTEXT_FILES = [
    'AGENT.local.md',
    'AGENT.md',
    'DEEPA.local.md',
    'DEEPA.md',
    'CLAUDE.md',
    'AGENTS.md',
    '.agents.md'
];

const RULE_DIRS = ['.deepa/rules', '.agent/rules'];

function processContent(content: string, baseDir: string, visited: Set<string>): string {
    return content.replace(/@([a-zA-Z0-9_./-]+)/g, (match, importPath) => {
        const fullPath = join(baseDir, importPath);
        if (visited.has(fullPath)) return match;

        if (existsSync(fullPath)) {
            const stat = statSync(fullPath);
            if (stat.isFile()) {
                visited.add(fullPath);
                const fileContent = readFileSync(fullPath, 'utf-8');
                // Process imports recursively
                const processed = processContent(fileContent, dirname(fullPath), visited);
                return `${match}\n\n--- Imported from ${importPath} ---\n${processed}\n--- End import ---`;
            }
        }
        return match;
    });
}

function loadRules(cwd: string, visited: Set<string>): string[] {
    const parts: string[] = [];
    for (const dir of RULE_DIRS) {
        const fullDir = join(cwd, dir);
        if (existsSync(fullDir)) {
            const stat = statSync(fullDir);
            if (stat.isDirectory()) {
                const files = readdirSync(fullDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
                for (const file of files) {
                    const filePath = join(fullDir, file);
                    visited.add(filePath);
                    const content = readFileSync(filePath, 'utf-8');
                    const processed = processContent(content, dirname(filePath), visited);
                    parts.push(`# Rule: ${dir}/${file}\n\n${processed}`);
                }
            }
        }
    }
    return parts;
}

/**
 * Load project context from AGENT.md and similar files.
 * Searches: project root, then global ~/.deepa/
 * Also supports @import directives and .agent/rules/ directories.
 */
export function loadAgentsMd(cwd: string): string | undefined {
    const parts: string[] = [];
    const visited = new Set<string>();

    // Global context
    const globalDir = join(homedir(), '.deepa');
    for (const filename of CONTEXT_FILES) {
        const globalPath = join(globalDir, filename);
        if (existsSync(globalPath) && statSync(globalPath).isFile()) {
            visited.add(globalPath);
            const content = readFileSync(globalPath, 'utf-8');
            const processed = processContent(content, dirname(globalPath), visited);
            parts.push(`# Global Context (${filename})\n\n${processed}`);
        }
    }

    // Project context
    for (const filename of CONTEXT_FILES) {
        const projectPath = join(cwd, filename);
        if (existsSync(projectPath) && statSync(projectPath).isFile()) {
            visited.add(projectPath);
            const content = readFileSync(projectPath, 'utf-8');
            const processed = processContent(content, dirname(projectPath), visited);
            parts.push(`# Project Context (${filename})\n\n${processed}`);
        }
    }

    // Rules Directories
    const rules = loadRules(cwd, visited);
    parts.push(...rules);

    return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined;
}
