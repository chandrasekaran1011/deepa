// ─── Input history — persists user prompts across sessions ───

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HISTORY_FILE = join(homedir(), '.deepa', 'input-history.json');
const MAX_HISTORY = 500;

/**
 * Load input history from disk. Returns empty array if file doesn't exist.
 */
export function loadInputHistory(): string[] {
    if (!existsSync(HISTORY_FILE)) return [];
    try {
        const data = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
        if (Array.isArray(data)) return data.slice(-MAX_HISTORY);
        return [];
    } catch {
        return [];
    }
}

/**
 * Save input history to disk, capped at MAX_HISTORY entries.
 */
export function saveInputHistory(history: string[]): void {
    const trimmed = history.slice(-MAX_HISTORY);
    try {
        writeFileSync(HISTORY_FILE, JSON.stringify(trimmed), 'utf-8');
    } catch {
        // Silently ignore write errors (e.g., permissions)
    }
}

/**
 * Append a line to history, deduplicating consecutive identical entries.
 */
export function appendToHistory(history: string[], line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed) return history;
    // Don't add if same as last entry
    if (history.length > 0 && history[history.length - 1] === trimmed) return history;
    return [...history, trimmed].slice(-MAX_HISTORY);
}
