// ─── Conversation history / session management ───

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Message } from '../types.js';

const SESSIONS_DIR = join(homedir(), '.deepa', 'sessions');

function ensureSessionsDir(): string {
    if (!existsSync(SESSIONS_DIR)) {
        mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    return SESSIONS_DIR;
}

export interface Session {
    id: string;
    createdAt: string;
    updatedAt: string;
    cwd: string;
    messages: Message[];
}

/**
 * Create a new session.
 */
export function createSession(cwd: string): Session {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd,
        messages: [],
    };
}

/**
 * Save a session to disk.
 */
export function saveSession(session: Session): void {
    const dir = ensureSessionsDir();
    session.updatedAt = new Date().toISOString();
    writeFileSync(join(dir, `${session.id}.json`), JSON.stringify(session, null, 2), 'utf-8');
}

/**
 * Load a session by ID.
 */
export function loadSession(id: string): Session | null {
    const path = join(SESSIONS_DIR, `${id}.json`);
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * Load the most recent session (for resume).
 */
export function loadLatestSession(cwd?: string): Session | null {
    const dir = ensureSessionsDir();
    const files = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();

    for (const file of files) {
        const session = loadSession(file.replace('.json', ''));
        if (session && (!cwd || session.cwd === cwd)) {
            return session;
        }
    }
    return null;
}

/**
 * List recent sessions.
 */
export function listSessions(limit = 10): Session[] {
    const dir = ensureSessionsDir();
    const files = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, limit);

    return files
        .map((f) => loadSession(f.replace('.json', '')))
        .filter((s): s is Session => s !== null);
}
