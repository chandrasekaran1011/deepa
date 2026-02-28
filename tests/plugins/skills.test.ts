/**
 * Skills system tests — loader, registry, use_skill tool, and progressive disclosure.
 *
 * Creates 6 dummy skills in a temp directory and verifies the full lifecycle:
 *   1. SKILL.md discovery from multiple directories
 *   2. Frontmatter parsing and validation
 *   3. SkillRegistry API (add, get, list, getDescriptions)
 *   4. use_skill tool invocation (progressive disclosure + file reading)
 *   5. Edge cases (missing files, no frontmatter, duplicate names, large files)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadSkills, parseFrontmatter, SkillRegistry, validateFrontmatter, readSkillBody, readSkillFile } from '../../src/plugins/skills.js';
import { createUseSkillTool } from '../../src/tools/use-skill.js';
import type { ToolContext } from '../../src/types.js';

const TEST_DIR = join(tmpdir(), 'deepa-skills-test-' + Date.now());

function makeContext(): ToolContext {
    return {
        cwd: TEST_DIR,
        autonomy: 'high',
        confirmAction: async () => true,
        log: () => { },
    };
}

// ─── 6 Dummy Skills ───

const SKILLS = {
    'python-expert': {
        frontmatter: `---
name: python-expert
description: Use for writing or debugging Python code, data science, and ML tasks.
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

        it('parses allowed-tools field', () => {
            const result = parseFrontmatter(`---
name: test
description: Test skill
allowed-tools: shell, file_write
---

Instructions here.`);
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
    // 1b. Frontmatter Validation
    // ═══════════════════════════════════════════
    describe('validateFrontmatter', () => {
        it('accepts valid frontmatter', () => {
            const errors = validateFrontmatter({ name: 'my-skill', description: 'A valid skill' }, 'fallback');
            expect(errors).toHaveLength(0);
        });

        it('rejects name exceeding 64 characters', () => {
            const errors = validateFrontmatter({ name: 'a'.repeat(65), description: 'ok' }, 'fallback');
            expect(errors.some(e => e.field === 'name' && e.message.includes('64'))).toBe(true);
        });

        it('rejects name with uppercase letters', () => {
            const errors = validateFrontmatter({ name: 'MySkill', description: 'ok' }, 'fallback');
            expect(errors.some(e => e.field === 'name' && e.message.includes('lowercase'))).toBe(true);
        });

        it('rejects name with spaces or special characters', () => {
            const errors = validateFrontmatter({ name: 'my skill!', description: 'ok' }, 'fallback');
            expect(errors.some(e => e.field === 'name')).toBe(true);
        });

        it('rejects name containing reserved words', () => {
            const errors = validateFrontmatter({ name: 'anthropic-helper', description: 'ok' }, 'fallback');
            expect(errors.some(e => e.message.includes('reserved'))).toBe(true);

            const errors2 = validateFrontmatter({ name: 'claude-tools', description: 'ok' }, 'fallback');
            expect(errors2.some(e => e.message.includes('reserved'))).toBe(true);
        });

        it('rejects empty description', () => {
            const errors = validateFrontmatter({ name: 'ok-skill', description: '' }, 'fallback');
            expect(errors.some(e => e.field === 'description' && e.message.includes('required'))).toBe(true);
        });

        it('rejects missing description', () => {
            const errors = validateFrontmatter({ name: 'ok-skill' }, 'fallback');
            expect(errors.some(e => e.field === 'description')).toBe(true);
        });

        it('rejects description exceeding 1024 characters', () => {
            const errors = validateFrontmatter({ name: 'ok-skill', description: 'x'.repeat(1025) }, 'fallback');
            expect(errors.some(e => e.field === 'description' && e.message.includes('1024'))).toBe(true);
        });

        it('uses fallback name when name not in frontmatter', () => {
            const errors = validateFrontmatter({ description: 'ok' }, 'my-fallback');
            // Should validate the fallback name
            expect(errors).toHaveLength(0);
        });

        it('rejects fallback name with uppercase', () => {
            const errors = validateFrontmatter({ description: 'ok' }, 'MyFallback');
            expect(errors.some(e => e.field === 'name')).toBe(true);
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

        it('loads all 6 dummy skills with correct metadata', () => {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(skillsDir, { recursive: true });

            for (const [name, data] of Object.entries(SKILLS)) {
                createSkillDir(skillsDir, name, data.frontmatter, data.body);
            }

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            expect(registry.size).toBe(6);

            const python = registry.get('python-expert')!;
            expect(python.description).toContain('Python');
            expect(python.allowedTools).toEqual(['shell', 'file_write', 'file_edit']);
            expect(python.dir).toContain('python-expert');

            // Body is NOT stored — only loaded on demand
            expect((python as any).instructions).toBeUndefined();

            // But readSkillBody can fetch it
            const body = readSkillBody(python);
            expect(body).toContain('type hints');

            const react = registry.get('react-engineer')!;
            expect(react.allowedTools).toBeUndefined();

            const testing = registry.get('testing-guru')!;
            const testingBody = readSkillBody(testing);
            expect(testingBody).toContain('TDD');
        });

        it('stores skill directory path', () => {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(skillsDir, { recursive: true });
            createSkillDir(skillsDir, 'python-expert', SKILLS['python-expert'].frontmatter, SKILLS['python-expert'].body);

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            const skill = registry.get('python-expert')!;
            expect(skill.dir).toBe(join(skillsDir, 'python-expert'));
            expect(skill.path).toBe(join(skillsDir, 'python-expert', 'SKILL.md'));
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

        it('loads skills from symlinked directories', () => {
            const realDir = join(TEST_DIR, 'real-skills');
            const linkDir = join(TEST_DIR, 'linked-skills');
            mkdirSync(realDir, { recursive: true });
            mkdirSync(linkDir, { recursive: true });

            const targetSkillDir = join(realDir, 'symlinked-skill');
            mkdirSync(targetSkillDir, { recursive: true });
            writeFileSync(join(targetSkillDir, 'SKILL.md'), `---
name: symlinked-skill
description: Loaded via symlink
---

Body.`);

            symlinkSync(targetSkillDir, join(linkDir, 'symlinked-skill'), 'dir');

            const registry = loadSkills(TEST_DIR, [linkDir]);
            expect(registry.size).toBe(1);
            expect(registry.get('symlinked-skill')).toBeDefined();
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
            // Body is read from filesystem — should get the latest version
            const body = readSkillBody(skill);
            expect(body).toContain('New instructions');
        });
    });

    // ═══════════════════════════════════════════
    // 3. SkillRegistry API
    // ═══════════════════════════════════════════
    describe('SkillRegistry', () => {
        it('getDescriptions returns name: description format', () => {
            const registry = new SkillRegistry();
            registry.add({ name: 'skill-a', description: 'Does A', path: '', dir: '' });
            registry.add({ name: 'skill-b', description: 'Does B', path: '', dir: '' });

            const descs = registry.getDescriptions();
            expect(descs).toHaveLength(2);
            expect(descs[0]).toBe('skill-a: Does A');
            expect(descs[1]).toBe('skill-b: Does B');
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

        it('includes skill directory path', async () => {
            const registry = makeRegistryWithSkills();
            const tool = createUseSkillTool(registry);

            const result = await tool.execute({ name: 'python-expert' }, makeContext());
            expect(result.content).toContain('Skill directory:');
        });

        it('includes hint about referenced files', async () => {
            const registry = makeRegistryWithSkills();
            const tool = createUseSkillTool(registry);

            const result = await tool.execute({ name: 'python-expert' }, makeContext());
            expect(result.content).toContain('use_skill');
            expect(result.content).toContain('file');
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
            expect(result.content).toContain('python-expert');
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

        it('reads referenced files within skill directory', async () => {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(skillsDir, { recursive: true });
            createSkillDir(skillsDir, 'python-expert', SKILLS['python-expert'].frontmatter, SKILLS['python-expert'].body);

            // Add a referenced file
            writeFileSync(join(skillsDir, 'python-expert', 'REFERENCE.md'), '# API Reference\n\nDetailed API docs here.');

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            const tool = createUseSkillTool(registry);

            const result = await tool.execute({ name: 'python-expert', file: 'REFERENCE.md' }, makeContext());
            expect(result.isError).toBeUndefined();
            expect(result.content).toContain('API Reference');
            expect(result.content).toContain('Detailed API docs here');
        });

        it('returns error for non-existent referenced file', async () => {
            const registry = makeRegistryWithSkills();
            const tool = createUseSkillTool(registry);

            const result = await tool.execute({ name: 'python-expert', file: 'NONEXISTENT.md' }, makeContext());
            expect(result.content).toContain('not found');
            expect(result.content).toContain('Available files');
        });

        it('lists directory contents when file param is a directory', async () => {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(skillsDir, { recursive: true });
            createSkillDir(skillsDir, 'python-expert', SKILLS['python-expert'].frontmatter, SKILLS['python-expert'].body);
            mkdirSync(join(skillsDir, 'python-expert', 'scripts'), { recursive: true });
            writeFileSync(join(skillsDir, 'python-expert', 'scripts', 'validate.py'), 'print("ok")');

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            const tool = createUseSkillTool(registry);

            const result = await tool.execute({ name: 'python-expert', file: 'scripts' }, makeContext());
            expect(result.content).toContain('validate.py');
        });

        it('is registered with safe safety level', () => {
            const registry = new SkillRegistry();
            const tool = createUseSkillTool(registry);
            expect(tool.riskLevel).toBe('low');
        });
    });

    // ═══════════════════════════════════════════
    // 5. readSkillBody and readSkillFile
    // ═══════════════════════════════════════════
    describe('readSkillBody / readSkillFile', () => {
        it('readSkillBody reads body from filesystem on demand', () => {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(skillsDir, { recursive: true });
            createSkillDir(skillsDir, 'python-expert', SKILLS['python-expert'].frontmatter, SKILLS['python-expert'].body);

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            const skill = registry.get('python-expert')!;
            const body = readSkillBody(skill);
            expect(body).toContain('type hints');
            expect(body).toContain('pathlib');
            expect(body).not.toContain('---');  // Frontmatter should be stripped
        });

        it('readSkillBody returns error if SKILL.md deleted', () => {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(skillsDir, { recursive: true });
            createSkillDir(skillsDir, 'temp-skill', `---
name: temp-skill
description: Temporary
---`, 'Body.');

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            const skill = registry.get('temp-skill')!;

            // Delete the file
            rmSync(skill.path);

            const body = readSkillBody(skill);
            expect(body).toContain('Error');
        });

        it('readSkillFile prevents path traversal', () => {
            const skillsDir = join(TEST_DIR, 'skills');
            mkdirSync(skillsDir, { recursive: true });
            createSkillDir(skillsDir, 'python-expert', SKILLS['python-expert'].frontmatter, SKILLS['python-expert'].body);

            const registry = loadSkills(TEST_DIR, [skillsDir]);
            const skill = registry.get('python-expert')!;

            const result = readSkillFile(skill, '../../etc/passwd');
            expect(result).toContain('Error');
        });
    });

    // ═══════════════════════════════════════════
    // 6. System Prompt Integration
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

            const joined = descriptions.join('\n');
            expect(joined).not.toContain('## Instructions');
            expect(joined).not.toContain('type hints');
            expect(joined).not.toContain('functional components');

            expect(joined).toContain('python-expert');
            expect(joined).toContain('react-engineer');
            expect(joined).toContain('testing-guru');
        });

        it('descriptions format is "name: description"', () => {
            const registry = new SkillRegistry();
            registry.add({ name: 'test-skill', description: 'Does testing things', path: '/tmp/test', dir: '/tmp' });

            const descs = registry.getDescriptions();
            expect(descs[0]).toBe('test-skill: Does testing things');
        });
    });
});
