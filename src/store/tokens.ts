// ─── Token usage tracking ───
// Persists per-turn token usage to ~/.deepa/tokens.json
// Supports querying by month/year and aggregation by model

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DEEPA_DIR = join(homedir(), '.deepa');
const TOKENS_FILE = join(DEEPA_DIR, 'tokens.json');

// ────────────────── Types ──────────────────

export interface TokenEntry {
    date: string;           // YYYY-MM-DD
    model: string;          // e.g. "gpt-4o", "claude-sonnet-4-20250514"
    provider: string;       // e.g. "openai", "anthropic"
    promptTokens: number;
    completionTokens: number;
    sessionId: string;
}

interface TokenStore {
    version: 1;
    entries: TokenEntry[];
}

// ────────────────── Storage helpers ──────────────────

function loadStore(): TokenStore {
    if (!existsSync(TOKENS_FILE)) {
        return { version: 1, entries: [] };
    }
    try {
        return JSON.parse(readFileSync(TOKENS_FILE, 'utf-8'));
    } catch {
        return { version: 1, entries: [] };
    }
}

function saveStore(store: TokenStore): void {
    if (!existsSync(DEEPA_DIR)) {
        mkdirSync(DEEPA_DIR, { recursive: true });
    }
    writeFileSync(TOKENS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

// ────────────────── Public API ──────────────────

/**
 * Record a token usage entry (one per LLM turn).
 */
export function recordTokenUsage(entry: Omit<TokenEntry, 'date'>): void {
    const store = loadStore();
    store.entries.push({
        ...entry,
        date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
    });
    saveStore(store);
}

/**
 * Get raw token entries filtered by month/year.
 * Defaults to current month if not specified.
 */
export function getTokenUsage(month?: number, year?: number): TokenEntry[] {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();
    const prefix = `${y}-${String(m).padStart(2, '0')}`;

    const store = loadStore();
    return store.entries.filter((e) => e.date.startsWith(prefix));
}

/**
 * Get token usage aggregated by model for a given month/year.
 */
export function getTokenSummary(month?: number, year?: number): {
    model: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}[] {
    const entries = getTokenUsage(month, year);
    const map = new Map<string, { provider: string; promptTokens: number; completionTokens: number }>();

    for (const e of entries) {
        const existing = map.get(e.model);
        if (existing) {
            existing.promptTokens += e.promptTokens;
            existing.completionTokens += e.completionTokens;
        } else {
            map.set(e.model, {
                provider: e.provider,
                promptTokens: e.promptTokens,
                completionTokens: e.completionTokens,
            });
        }
    }

    return Array.from(map.entries())
        .map(([model, data]) => ({
            model,
            provider: data.provider,
            promptTokens: data.promptTokens,
            completionTokens: data.completionTokens,
            totalTokens: data.promptTokens + data.completionTokens,
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens);
}
