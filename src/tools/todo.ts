// ─── Todo tool — Claude Code TodoWrite pattern ───
// Full-list replacement model: each call writes the complete todo list.
// Supports pending → in_progress → completed state transitions.
// The UI renders todos in real-time via onToolCall/onToolResult callbacks.

import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const todoItemSchema = z.object({
    content: z.string().min(1).describe('Imperative task description (e.g., "Run tests", "Fix login bug")'),
    status: z.enum(['pending', 'in_progress', 'completed']).describe('Task state'),
});

const parameters = z.object({
    todos: z.array(todoItemSchema).describe('The complete updated todo list — replaces the previous list entirely'),
});

export type TodoItem = z.infer<typeof todoItemSchema>;

/** In-memory todo store — shared across the session */
let currentTodos: TodoItem[] = [];

/** Read the current todo list (for UI or tests) */
export function getTodos(): TodoItem[] {
    return currentTodos;
}

/** Reset todos (for tests) */
export function resetTodos(): void {
    currentTodos = [];
}

/** Format the todo list for terminal display */
export function formatTodos(todos: TodoItem[]): string {
    if (todos.length === 0) return 'No tasks.';

    const completed = todos.filter((t) => t.status === 'completed').length;
    const total = todos.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Progress bar
    const barWidth = 20;
    const filled = Math.round((completed / total) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

    const lines: string[] = [];

    for (const todo of todos) {
        let icon: string;
        let text: string;
        switch (todo.status) {
            case 'completed':
                icon = '✓';
                text = todo.content;
                break;
            case 'in_progress':
                icon = '▸';
                text = todo.content;
                break;
            default:
                icon = '○';
                text = todo.content;
        }
        lines.push(`  ${icon} ${text}`);
    }

    lines.push('');
    lines.push(`  ${bar}  ${completed}/${total} (${pct}%)`);

    return lines.join('\n');
}

export const todoTool: Tool = {
    name: 'todo',
    description:
        'Track task progress with a structured todo list. Pass the COMPLETE updated list each time (full replacement). ' +
        'Use status: "pending" for not started, "in_progress" for current work (max 1), "completed" for done. ' +
        'Update frequently as you work through tasks.',
    parameters,
    riskLevel: 'low',

    async execute(params: unknown, _context: ToolContext): Promise<ToolResult> {
        const { todos } = params as z.infer<typeof parameters>;

        // Validate: at most one in_progress
        const inProgress = todos.filter((t) => t.status === 'in_progress');
        if (inProgress.length > 1) {
            return {
                content: `Error: Only one task can be in_progress at a time (found ${inProgress.length}). ` +
                    `Complete the current task before starting another.`,
                isError: true,
            };
        }

        // Store
        currentTodos = todos;

        const completed = todos.filter((t) => t.status === 'completed').length;
        const total = todos.length;

        return {
            content: formatTodos(todos) + `\n\nTodo list updated: ${completed}/${total} completed.`,
        };
    },
};
