// ─── Todo tool — agentic task tracking ───
// Full-list replacement model: each call writes the complete todo list.
// The LLM is encouraged to dynamically add, split, remove, and reorder tasks
// as it discovers new work during execution.

import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const todoItemSchema = z.object({
    content: z.coerce.string().min(1).describe('Imperative task description (e.g., "Run tests", "Fix login bug")'),
    status: z.enum(['pending', 'in_progress', 'completed']).catch('pending').describe('Task state'),
    activeForm: z.coerce.string().optional().catch(undefined).describe('Present-tense label shown during execution (e.g., "Running tests", "Fixing login bug")'),
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

/**
 * Build an actionable feedback message based on the current state of todos.
 * This nudges the LLM to take the right next action.
 */
function buildFeedback(prev: TodoItem[], next: TodoItem[]): string {
    const completed = next.filter((t) => t.status === 'completed').length;
    const pending = next.filter((t) => t.status === 'pending').length;
    const inProgress = next.filter((t) => t.status === 'in_progress');
    const total = next.length;

    const parts: string[] = [];

    // Detect what changed
    const prevNames = new Set(prev.map((t) => t.content));
    const nextNames = new Set(next.map((t) => t.content));
    const added = next.filter((t) => !prevNames.has(t.content));
    const removed = prev.filter((t) => !nextNames.has(t.content));
    const newlyCompleted = next.filter(
        (t) => t.status === 'completed' && prev.find((p) => p.content === t.content)?.status !== 'completed',
    );

    // Summary line
    parts.push(`Todo list updated: ${completed}/${total} completed.`);

    // Change details
    if (newlyCompleted.length > 0) {
        parts.push(`Completed: ${newlyCompleted.map((t) => `"${t.content}"`).join(', ')}`);
    }
    if (added.length > 0) {
        parts.push(`Added: ${added.map((t) => `"${t.content}"`).join(', ')}`);
    }
    if (removed.length > 0) {
        parts.push(`Removed: ${removed.map((t) => `"${t.content}"`).join(', ')}`);
    }

    // Actionable nudges
    if (completed === total && total > 0) {
        parts.push('All tasks completed! Summarize the results to the user.');
    } else if (inProgress.length === 0 && pending > 0) {
        parts.push(`WARNING: No task is in_progress but ${pending} tasks are pending. Set the next task to "in_progress" and continue working.`);
    } else if (inProgress.length === 1 && pending > 0) {
        parts.push(`Next up: "${inProgress[0].content}" — ${pending} more pending after this.`);
    } else if (inProgress.length === 1 && pending === 0) {
        parts.push(`Final task: "${inProgress[0].content}" — complete this and mark it done.`);
    }

    return parts.join('\n');
}

export const todoTool: Tool = {
    name: 'todo',
    description:
        'Track task progress with a structured todo list. Pass the COMPLETE updated list each time (full replacement). ' +
        'Use status: "pending" for not started, "in_progress" for current work (max 1), "completed" for done. ' +
        'The list is DYNAMIC — add new tasks you discover, split large tasks, remove irrelevant ones. ' +
        'Update after EVERY task completion. Always mark the final task completed when done.',
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

        // Capture previous state for diff feedback
        const prev = currentTodos;

        // Store
        currentTodos = todos;

        const feedback = buildFeedback(prev, todos);

        return {
            content: formatTodos(todos) + '\n\n' + feedback,
        };
    },
};
