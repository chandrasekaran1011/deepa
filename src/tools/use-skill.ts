// ─── use_skill tool ───
// Progressive disclosure: LLM reads full skill instructions on demand.

import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';
import type { SkillRegistry } from '../plugins/skills.js';

const parameters = z.object({
    name: z.string().describe('Name of the skill to activate (from the Available Skills list)'),
});

/**
 * Factory: creates a use_skill tool bound to a specific SkillRegistry.
 * This lets the LLM read a skill's full instructions when it decides the skill is relevant.
 */
export function createUseSkillTool(skillRegistry: SkillRegistry): Tool {
    return {
        name: 'use_skill',
        description:
            'Read the full instructions for a skill listed in "Available Skills". ' +
            'Call this when a user request matches a skill\'s description. ' +
            'Returns the skill\'s detailed instructions, guidelines, and any referenced resources.',
        parameters,
        riskLevel: 'low',

        async execute(params: unknown, _context: ToolContext): Promise<ToolResult> {
            const { name } = params as z.infer<typeof parameters>;

            const skill = skillRegistry.get(name);
            if (!skill) {
                const available = skillRegistry.list().map((s) => s.name).join(', ');
                return {
                    content: `Error: Skill "${name}" not found. Available skills: ${available || 'none'}`,
                    isError: true,
                };
            }

            const parts: string[] = [
                `# Skill: ${skill.name}`,
                `**Description:** ${skill.description}`,
            ];

            if (skill.allowedTools?.length) {
                parts.push(`**Allowed tools:** ${skill.allowedTools.join(', ')}`);
            }

            parts.push('', '## Instructions', '', skill.instructions);

            return {
                content: parts.join('\n'),
            };
        },
    };
}
