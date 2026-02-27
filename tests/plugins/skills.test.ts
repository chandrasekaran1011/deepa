/**
 * Skills system tests — loader, registry, use_skill tool, and progressive disclosure.
 *
 * Creates 6 dummy skills in a temp directory and verifies the full lifecycle:
 *   1. SKILL.md discovery from multiple directories
 *   2. Frontmatter parsing (name, description, trigger, allowed-tools)
 *   3. SkillRegistry API (add, get, list, match, getDescriptions)
 *   4. use_skill tool invocation (progressive disclosure)
 *   5. Trigger-based context matching
 *   6. Edge cases (missing files, no frontmatter, duplicate names, large files)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadSkills, parseFrontmatter, SkillRegistry } from '../../src/plugins/skills.js';
import { createUseSkillTool } from '../../src/tools/use-skill.js';
import type { ToolContext } from '../../src/types.js';

const TEST_DIR = join(tmpdir(), 'deepa-skills-test-' + Date.now());

function makeContext(): ToolContext {
    return {
        cwd: TEST_DIR,
        autonomy: 'high',
        confirmAction: async () => true,
        log: () => {},
    };
}

// ─── 6 Dummy Skills ───

const SKILLS = {
    'python-expert': {
        frontmatter: `---
name: python-expert
description: Use for writing or debugging Python code, data science, and ML tasks.
trigger: python|pandas|numpy|pytorch|sklearn
allowed-tools: shell, file_write, file_edit
---`,
        body: `# python-expert

## Instructions

1. Always use type hints.
2. Prefer pathlib over os.path.
3. Use Google-style docstrings.
4. For data science, prefer pandas and numpy.`,
    },
    'react-engineer': {
        frontmatter: `---
name: react-engineer
description: Use when writing or debugging React components, hooks, or frontend architecture.
trigger: react|jsx|tsx|component|hook|useState|useEffect
---`,
        body: `# react-engineer

## Instructions

1. Use functional components and hooks exclusively.
2. Extract props to an interface ending with Props.
3. Separate business logic into custom hooks.`,
    },
    'api-designer': {
        frontmatter: `---
name: api-designer
description: Use for designing REST APIs, OpenAPI specs, or backend route architecture.
trigger: api|endpoint|route|REST|openapi|swagger
allowed-tools: file_write, web_search
---`,
        body: `# api-designer

## Instructions

1. Follow REST conventions (plural nouns, HTTP verbs).
2. Always version APIs (/v1/).
3. Return consistent error shapes.`,
    },
    'git-workflow': {
        frontmatter: `---
name: git-workflow
description: Use for git operations, branch management, merge conflicts, and PR workflows.
trigger: git|branch|merge|rebase|commit|pull request|PR
---`,
        body: `# git-workflow

## Instructions

1. Always create feature branches from main.
2. Write conventional commit messages.
3. Squash-merge feature branches.`,
    },
    'database-tuning': {
        frontmatter: `---
name: database-tuning
description: Use for SQL optimization, indexing strategies, and database schema design.
trigger: sql|query|index|database|postgres|mysql|schema
---`,
        body: `# database-tuning

## Instructions

1. Always EXPLAIN ANALYZE before optimizing.
2. Add indexes for frequently filtered columns.
3. Normalize to 3NF unless performance requires denormalization.`,
    },
    'testing-guru': {
        frontmatter: `---
name: testing-guru
description: Use for writing tests, test strategy, mocking, and CI/CD test pipelines.
---`,
        body: `# testing-guru

## Instructions

1. Write tests before code when possible (TDD).
2. Use describe/it/expect patterns.
3. Mock external dependencies at boundaries.
4. Aim for 80%+ coverage on business logic.`,
    },
};

function createSkillDir(baseDir: string, name: string, frontmatter: string, body: string): void {
    const skillDir = join(baseDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `${frontmatter}\n\n${body}`);
}

// ─── Tests ───

describe('Skills System', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    // ═══════════════════════════════════════════
    // 1. Frontmatter Parser
    // ═══════════════════════════════════════════
    describe('parseFrontmatter', () => {
        it('parses standard frontmatter with name and description', () => {
            const result = parseFrontmatter(`---
name: my-skill
description: A test skill
---

# my-skill

Body content here.`);
            expect(result.frontmatter.name).toBe('my-skill');
            expect(result.frontmatter.description).toBe('A test skill');
            expect(result.body).toContain('Body content here.');
        });

        it('parses trigger and allowed-tools fields', () => {
            const result = parseFrontmatter(`---
name: test
description: Test skill
trigger: python|ml|data
allowed-tools: shell, file_write
---

Instructions here.`);
            expect(result.frontmatter.trigger).toBe('python|ml|data');
            expect(result.frontmatter['allowed-tools']).toBe('shell, file_write');
        });

        it('returns empty frontmatter when no --- delimiters', () => {
            const result = parseFrontmatter('Just plain content without frontmatter.');
            expect(result.frontmatter).toEqual({});
            expect(result.body).toBe('Just plain content without frontmatter.');
        });

        it('handles colons in description values', () => {
            const result = parseFrontmatter(`---
name: test
description: Use this skill for: writing code and debugging
---

Body.`);
            expect(result.frontmatter.description).toBe('Use this skill for: writing code and debugging');
        });
    });

    // ═══════════════════════════════════════════
    // 2. Skill Loading from Directories
    // ═══════════════════════════════════════════
    describe('loadSkills', () => {
        it('loads skills from a single directory', () => {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(skillsDir, { recursive: true });

            createSkillDir(skillsDir, 'python-expert', SKILLS['python-expert'].frontmatter, SKILLS['python-expert'].body);
            createSkillDir(skillsDir, 'react-engineer', SKILLS['react-engineer'].frontmatter, SKILLS['react-engineer'].body);

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            expect(registry.size).toBe(2);
            expect(registry.get('python-expert')).toBeDefined();
            expect(registry.get('react-engineer')).toBeDefined();
        });

        it('loads skills from multiple directories', () => {
            const dir1 = join(TEST_DIR, 'dir1');
            const dir2 = join(TEST_DIR, 'dir2');
            mkdirSync(dir1, { recursive: true });
            mkdirSync(dir2, { recursive: true });

            createSkillDir(dir1, 'api-designer', SKILLS['api-designer'].frontmatter, SKILLS['api-designer'].body);
            createSkillDir(dir2, 'git-workflow', SKILLS['git-workflow'].frontmatter, SKILLS['git-workflow'].body);

            const registry = loadSkills(TEST_DIR, [dir1, dir2]);
            expect(registry.size).toBe(2);
            expect(registry.get('api-designer')).toBeDefined();
            expect(registry.get('git-workflow')).toBeDefined();
        });

        it('loads all 6 dummy skills correctly', () => {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(skillsDir, { recursive: true });

            for (const [name, data] of Object.entries(SKILLS)) {
                createSkillDir(skillsDir, name, data.frontmatter, data.body);
            }

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            expect(registry.size).toBe(6);

            // Verify each skill has correct metadata
            const python = registry.get('python-expert')!;
            expect(python.description).toContain('Python');
            expect(python.trigger).toBe('python|pandas|numpy|pytorch|sklearn');
            expect(python.allowedTools).toEqual(['shell', 'file_write', 'file_edit']);
            expect(python.instructions).toContain('type hints');

            const react = registry.get('react-engineer')!;
            expect(react.trigger).toContain('react');
            expect(react.allowedTools).toBeUndefined();

            const testing = registry.get('testing-guru')!;
            expect(testing.trigger).toBeUndefined();
            expect(testing.instructions).toContain('TDD');
        });

        it('uses directory name as fallback when name missing from frontmatter', () => {
            const skillsDir = join(TEST_DIR, 'skills');
            const skillDir = join(skillsDir, 'my-custom-skill');
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(join(skillDir, 'SKILL.md'), `---
description: A skill without a name field
---

Instructions here.`);

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            expect(registry.size).toBe(1);
            expect(registry.get('my-custom-skill')).toBeDefined();
        });

        it('skips directories without SKILL.md', () => {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(join(skillsDir, 'empty-dir'), { recursive: true });
            mkdirSync(join(skillsDir, 'also-empty'), { recursive: true });
            createSkillDir(skillsDir, 'valid-skill', `---
name: valid-skill
description: Has a SKILL.md
---`, 'Body.');

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            expect(registry.size).toBe(1);
        });

        it('returns empty registry when no skills directories exist', () => {
            const registry = loadSkills(TEST_DIR, [join(TEST_DIR, 'nonexistent')]);
            expect(registry.size).toBe(0);
        });

        it('last-wins when duplicate skill names from different directories', () => {
            const dir1 = join(TEST_DIR, 'first');
            const dir2 = join(TEST_DIR, 'second');
            mkdirSync(dir1, { recursive: true });
            mkdirSync(dir2, { recursive: true });

            createSkillDir(dir1, 'python-expert', `---
name: python-expert
description: Version 1 from first dir
---`, 'Old instructions.');

            createSkillDir(dir2, 'python-expert', `---
name: python-expert
description: Version 2 from second dir
---`, 'New instructions.');

            const registry = loadSkills(TEST_DIR, [dir1, dir2]);
            expect(registry.size).toBe(1);
            const skill = registry.get('python-expert')!;
            expect(skill.description).toContain('Version 2');
            expect(skill.instructions).toContain('New instructions');
        });
    });

    // ═══════════════════════════════════════════
    // 3. SkillRegistry API
    // ═══════════════════════════════════════════
    describe('SkillRegistry', () => {
        it('getDescriptions returns name: description format', () => {
            const registry = new SkillRegistry();
            registry.add({ name: 'skill-a', description: 'Does A', instructions: '', path: '' });
            registry.add({ name: 'skill-b', description: 'Does B', instructions: '', path: '' });

            const descs = registry.getDescriptions();
            expect(descs).toHaveLength(2);
            expect(descs[0]).toBe('skill-a: Does A');
            expect(descs[1]).toBe('skill-b: Does B');
        });

        it('match returns skills with matching trigger patterns', () => {
            const registry = new SkillRegistry();
            registry.add({ name: 'python', description: 'Python', instructions: '', path: '', trigger: 'python|pandas' });
            registry.add({ name: 'react', description: 'React', instructions: '', path: '', trigger: 'react|jsx' });
            registry.add({ name: 'generic', description: 'No trigger', instructions: '', path: '' });

            const matches = registry.match('Help me write a python script');
            expect(matches).toHaveLength(1);
            expect(matches[0].name).toBe('python');
        });

        it('match is case-insensitive', () => {
            const registry = new SkillRegistry();
            registry.add({ name: 'react', description: 'React', instructions: '', path: '', trigger: 'react|jsx' });

            expect(registry.match('Write a REACT component')).toHaveLength(1);
            expect(registry.match('Create JSX template')).toHaveLength(1);
        });

        it('match returns multiple matching skills', () => {
            const registry = new SkillRegistry();
            registry.add({ name: 'api', description: 'API', instructions: '', path: '', trigger: 'api|endpoint' });
            registry.add({ name: 'testing', description: 'Testing', instructions: '', path: '', trigger: 'test|api' });

            const matches = registry.match('Write API tests');
            expect(matches).toHaveLength(2);
        });

        it('match returns empty array when nothing matches', () => {
            const registry = new SkillRegistry();
            registry.add({ name: 'python', description: 'Python', instructions: '', path: '', trigger: 'python' });

            expect(registry.match('Write a Rust program')).toHaveLength(0);
        });

        it('match handles invalid regex gracefully (falls back to substring)', () => {
            const registry = new SkillRegistry();
            registry.add({ name: 'broken', description: 'Broken', instructions: '', path: '', trigger: '[invalid regex(' });

            // Should not throw, falls back to substring matching
            expect(() => registry.match('test')).not.toThrow();
        });
    });

    // ═══════════════════════════════════════════
    // 4. use_skill Tool (Progressive Disclosure)
    // ═══════════════════════════════════════════
    describe('use_skill tool', () => {
        function makeRegistryWithSkills(): SkillRegistry {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(skillsDir, { recursive: true });
            for (const [name, data] of Object.entries(SKILLS)) {
                createSkillDir(skillsDir, name, data.frontmatter, data.body);
            }
            return loadSkills(TEST_DIR, [skillsDir]);
        }

        it('returns full instructions for a valid skill', async () => {
            const registry = makeRegistryWithSkills();
            const tool = createUseSkillTool(registry);

            const result = await tool.execute({ name: 'python-expert' }, makeContext());
            expect(result.isError).toBeUndefined();
            expect(result.content).toContain('# Skill: python-expert');
            expect(result.content).toContain('type hints');
            expect(result.content).toContain('pathlib');
            expect(result.content).toContain('Google-style docstrings');
        });

        it('includes allowed-tools when present', async () => {
            const registry = makeRegistryWithSkills();
            const tool = createUseSkillTool(registry);

            const result = await tool.execute({ name: 'api-designer' }, makeContext());
            expect(result.content).toContain('Allowed tools');
            expect(result.content).toContain('file_write');
            expect(result.content).toContain('web_search');
        });

        it('does not include allowed-tools when not specified', async () => {
            const registry = makeRegistryWithSkills();
            const tool = createUseSkillTool(registry);

            const result = await tool.execute({ name: 'react-engineer' }, makeContext());
            expect(result.content).not.toContain('Allowed tools');
        });

        it('returns error for unknown skill name', async () => {
            const registry = makeRegistryWithSkills();
            const tool = createUseSkillTool(registry);

            const result = await tool.execute({ name: 'nonexistent-skill' }, makeContext());
            expect(result.isError).toBe(true);
            expect(result.content).toContain('not found');
            expect(result.content).toContain('python-expert'); // Lists available skills
        });

        it('returns all 6 skills instructions correctly', async () => {
            const registry = makeRegistryWithSkills();
            const tool = createUseSkillTool(registry);

            for (const name of Object.keys(SKILLS)) {
                const result = await tool.execute({ name }, makeContext());
                expect(result.isError).toBeUndefined();
                expect(result.content).toContain(`# Skill: ${name}`);
                expect(result.content).toContain('## Instructions');
            }
        });

        it('is registered with safe safety level', () => {
            const registry = new SkillRegistry();
            const tool = createUseSkillTool(registry);
            expect(tool.riskLevel).toBe('low');
        });
    });

    // ═══════════════════════════════════════════
    // 5. Integration: System Prompt Descriptions
    // ═══════════════════════════════════════════
    describe('System prompt integration', () => {
        it('getDescriptions does NOT include full instructions (progressive disclosure)', () => {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(skillsDir, { recursive: true });
            for (const [name, data] of Object.entries(SKILLS)) {
                createSkillDir(skillsDir, name, data.frontmatter, data.body);
            }

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            const descriptions = registry.getDescriptions();

            expect(descriptions).toHaveLength(6);

            // Descriptions should NOT contain full instruction content
            const joined = descriptions.join('\n');
            expect(joined).not.toContain('## Instructions');
            expect(joined).not.toContain('type hints');
            expect(joined).not.toContain('functional components');

            // Should contain skill names
            expect(joined).toContain('python-expert');
            expect(joined).toContain('react-engineer');
            expect(joined).toContain('testing-guru');
        });

        it('descriptions format is "name: description"', () => {
            const registry = new SkillRegistry();
            registry.add({ name: 'test-skill', description: 'Does testing things', instructions: 'Full details...', path: '/tmp/test' });

            const descs = registry.getDescriptions();
            expect(descs[0]).toBe('test-skill: Does testing things');
            expect(descs[0]).not.toContain('Full details');
        });
    });
});
