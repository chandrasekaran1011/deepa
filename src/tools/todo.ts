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
    activeForm: z.coerce.string().optional().catch(undefined).describe('REQUIRED. Present-tense label shown during execution (e.g., "Running tests", "Fixing login bug"). Always provide this.'),
});

const parameters = z.object({
    todos: z.array(todoItemSchema).describe('The complete updated todo list — replaces the previous list entirely'),
});

export type TodoItem = z.infer<typeof todoItemSchema>;

/** Per-agent in-memory todo store keyed by agentId (empty string = root agent) */
const todoStore = new Map<string, TodoItem[]>();

/** Read the current todo list for a given agent (for UI or tests) */
export function getTodos(agentId = ''): TodoItem[] {
    return todoStore.get(agentId) ?? [];
}

/** Read todos for the root agent (convenience for UI) */
export function getRootTodos(): TodoItem[] {
    return getTodos('');
}

/** Reset todos for all agents (for tests) */
export function resetTodos(): void {
    todoStore.clear();
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

/** Minimum task count before verification nudge fires */
const VERIFY_NUDGE_MIN_TASKS = 3;

/**
 * Build an actionable feedback message based on the current state of todos.
 * Returns { message, verificationNudgeNeeded }.
 */
function buildFeedback(prev: TodoItem[], next: TodoItem[]): { message: string; verificationNudgeNeeded: boolean } {
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

    const allDone = completed === total && total > 0;

    // Verification nudge: all done, enough tasks, and no verification task existed
    const hasVerifyTask = next.some((t) => /verif/i.test(t.content));
    const verificationNudgeNeeded = allDone && total >= VERIFY_NUDGE_MIN_TASKS && !hasVerifyTask;

    // Actionable nudges
    if (allDone) {
        if (verificationNudgeNeeded) {
            parts.push(
                'All tasks completed. IMPORTANT: You have not verified your work. ' +
                'Before summarizing to the user, run the relevant tests or verification steps ' +
                '(e.g., run the test suite, build, or manually check the output). ' +
                'Only report success after you have confirmed the implementation is correct.',
            );
        } else {
            parts.push('All tasks completed. Summarize the results to the user.');
        }
    } else if (inProgress.length === 0 && pending > 0) {
        parts.push(`WARNING: No task is in_progress but ${pending} tasks are pending. Set the next task to "in_progress" and continue working.`);
    } else if (inProgress.length === 1 && pending > 0) {
        parts.push(`Next up: "${inProgress[0].content}" — ${pending} more pending after this.`);
    } else if (inProgress.length === 1 && pending === 0) {
        parts.push(`Final task: "${inProgress[0].content}" — complete this and mark it done.`);
    }

    return { message: parts.join('\n'), verificationNudgeNeeded };
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

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
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

        // Per-agent isolation: each spawn_agent subagent gets its own todo list
        const agentId = context.agentId ?? '';
        const prev = todoStore.get(agentId) ?? [];

        // First todo call = initial plan — request user approval before executing
        // (only for root agent, not subagents)
        if (agentId === '' && prev.length === 0 && todos.length > 0) {
            const response = await context.confirmAction(
                `PLAN_APPROVAL\n${JSON.stringify(todos)}`,
            );
            if (response === false) {
                return { content: 'Plan rejected by user. Ask what changes they want.', isError: true };
            } else if (typeof response === 'string') {
                return { content: `Plan rejected. User feedback: "${response}"\nRevise the plan based on this feedback.`, isError: true };
            }
        }

        // Auto-clear when all tasks are completed — prevents stale list lingering
        const allDone = todos.length > 0 && todos.every((t) => t.status === 'completed');
        const stored = allDone ? [] : todos;
        todoStore.set(agentId, stored);

        const { message, verificationNudgeNeeded } = buildFeedback(prev, todos);

        // Show the list before it clears (use original todos for display, not stored)
        const display = allDone ? formatTodos(todos) : formatTodos(stored);

        return {
            content: display + '\n\n' + message,
        };
    },
};
