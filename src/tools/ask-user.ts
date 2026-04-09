// ─── Ask User tool ───
// Allows the agent to ask the user structured questions with selectable options.
// The user can pick an option or type a custom response.

import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const optionSchema = z.object({
    label: z.string().describe('Short label for the option (1-5 words)'),
    description: z.string().optional().describe('Brief explanation of what this option means'),
});

const parameters = z.object({
    question: z.string().describe('The question to ask the user'),
    options: z.array(optionSchema).min(2).max(6).describe(
        'Selectable options (2-6). Put the recommended option first with "(Recommended)" suffix in the label.',
    ),
    allowCustom: z.boolean().optional().default(true).describe(
        'Whether to show a custom text input for the user to type a free-form answer (default: true)',
    ),
});

export type AskUserParams = z.infer<typeof parameters>;
export type AskUserOption = z.infer<typeof optionSchema>;

export const askUserTool: Tool = {
    name: 'ask_user',
    description:
        'Ask the user a question with selectable options. Use this when you need clarification, '
        + 'want to offer choices for ambiguous requests, need the user to pick between approaches, '
        + 'or need input before proceeding. Provide 2-6 concise, distinct options. '
        + 'The user can select an option or type a custom response. '
        + 'Do NOT use this for simple yes/no — just ask in your message text instead.',
    parameters,
    riskLevel: 'low',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { question, options, allowCustom } = params as AskUserParams;

        // Build structured payload for the UI
        const payload = {
            question,
            options,
            allowCustom,
        };

        // Use confirmAction with ASK_USER prefix — the UI layer will parse and render it
        const response = await context.confirmAction(`ASK_USER\n${JSON.stringify(payload)}`);

        if (response === false) {
            return { content: 'User dismissed the question without answering.' };
        }

        if (response === true) {
            // Shouldn't happen for ask_user, but handle gracefully
            return { content: 'User acknowledged the question.' };
        }

        // String response — either an option label or custom text
        return { content: `User answered: "${response}"` };
    },
};
