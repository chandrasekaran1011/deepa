// ─── use_skill tool ───
// Progressive disclosure: LLM reads full skill instructions on demand from filesystem.
// Supports reading referenced files within the skill directory.

import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';
import type { SkillRegistry } from '../plugins/skills.js';
import { readSkillBody, readSkillFile } from '../plugins/skills.js';

const parameters = z.object({
    name: z.string().describe('Name of the skill to activate (from the Available Skills list)'),
    file: z.string().optional().describe(
        'Optional: read a specific file within the skill directory instead of SKILL.md. ' +
        'Use this for referenced files like FORMS.md, REFERENCE.md, or scripts. ' +
        'Use forward slashes for paths (e.g. "reference/finance.md", "scripts/validate.py").'
    ),
});

/**
 * Factory: creates a use_skill tool bound to a specific SkillRegistry.
 * This lets the LLM read a skill's full instructions when it decides the skill is relevant,
 * and navigate referenced files within the skill directory.
 */
export function createUseSkillTool(skillRegistry: SkillRegistry): Tool {
    return {
        name: 'use_skill',
        description:
            'Read the full instructions for a skill listed in "Available Skills". ' +
            'Call this when a user request matches a skill\'s description. ' +
            'Returns the skill\'s detailed instructions and directory structure. ' +
            'Call again with the `file` parameter to read referenced files (e.g. FORMS.md, scripts/).',
        parameters,
        riskLevel: 'low',

        async execute(params: unknown, _context: ToolContext): Promise<ToolResult> {
            const { name, file } = params as z.infer<typeof parameters>;

            const skill = skillRegistry.get(name);
            if (!skill) {
                const available = skillRegistry.list().map((s) => s.name).join(', ');
                return {
                    content: `Error: Skill "${name}" not found. Available skills: ${available || 'none'}`,
                    isError: true,
                };
            }

            // If a specific file is requested, read it from the skill directory
            if (file) {
                const content = readSkillFile(skill, file);
                return {
                    content: `# Skill: ${skill.name} — File: ${file}\n\n${content}`,
                };
            }

            // Read full SKILL.md body from filesystem (lazy — not cached from startup)
            const body = readSkillBody(skill);

            const parts: string[] = [
                `# Skill: ${skill.name}`,
                `**Description:** ${skill.description}`,
                `**Skill directory:** ${skill.dir}`,
            ];

            if (skill.allowedTools?.length) {
                parts.push(`**Allowed tools:** ${skill.allowedTools.join(', ')}`);
            }

            parts.push('', '## Instructions', '', body);

            // Hint about referenced files
            parts.push(
                '',
                '---',
                '**Note:** If the instructions above reference other files (e.g. FORMS.md, REFERENCE.md, scripts/), ' +
                'call `use_skill` again with the `file` parameter to read them. ' +
                'Example: `use_skill(name: "' + skill.name + '", file: "FORMS.md")`',
            );

            return {
                content: parts.join('\n'),
            };
        },
    };
}
