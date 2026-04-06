// ─── Conversation history / session management ───
// Modeled after Claude Code's session storage:
//   - JSONL format (append-only, each message is one JSON line)
//   - UUID-based session IDs
//   - Sessions stored under ~/.deepa/sessions/{sanitized-cwd}/{uuid}.jsonl
//   - File mode 0o600 (owner-only) — sessions may contain secrets
//   - Incremental appends per message (no full rewrites)
//   - First user message extracted as session title
//   - Project-scoped listing: only sessions for the current cwd are shown

import {
    appendFileSync,
    writeFileSync,
    readFileSync,
    mkdirSync,
    existsSync,
    readdirSync,
    statSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { Message } from '../types.js';

// ─── Paths ───

const DEEPA_HOME = join(homedir(), '.deepa');

/**
 * Sanitize a cwd path into a safe directory name.
 * e.g. /Users/alice/projects/foo → Users-alice-projects-foo
 */
function sanitizePath(p: string): string {
    return p.replace(/^\//, '').replace(/\//g, '-').replace(/[^a-zA-Z0-9._-]/g, '_') || '_root';
}

function getSessionsDir(cwd: string): string {
    return join(DEEPA_HOME, 'sessions', sanitizePath(cwd));
}

function sessionFilePath(sessionDir: string, id: string): string {
    return join(sessionDir, `${id}.jsonl`);
}

// ─── Types ───

export interface SessionMeta {
    id: string;
    cwd: string;
    title: string;          // First user message (truncated)
    createdAt: string;
    updatedAt: string;
    messageCount: number;
}

export interface Session {
    id: string;
    cwd: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: Message[];
    filePath: string;
}

// ─── Header line ───
// First line of each .jsonl is a special header record (not a message).

interface SessionHeader {
    type: 'header';
    id: string;
    cwd: string;
    title: string;
    createdAt: string;
    version: number;
}

const CURRENT_VERSION = 1;

// ─── Extract title from messages ───

function extractTitle(messages: Message[]): string {
    for (const m of messages) {
        if (m.role === 'user') {
            const text = typeof m.content === 'string'
                ? m.content
                : m.content
                    .filter((c) => c.type === 'text')
                    .map((c) => (c as { type: 'text'; text: string }).text)
                    .join(' ');
            // Strip <user_input> wrapper if present
            const cleaned = text.replace(/<\/?user_input>/g, '').trim();
            return cleaned.slice(0, 80) || 'Untitled session';
        }
    }
    return 'Untitled session';
}

// ─── Create a new session ───

export function createSession(cwd: string): Session {
    const id = randomUUID();
    const now = new Date().toISOString();
    const dir = getSessionsDir(cwd);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const filePath = sessionFilePath(dir, id);

    const header: SessionHeader = {
        type: 'header',
        id,
        cwd,
        title: 'Untitled session',
        createdAt: now,
        version: CURRENT_VERSION,
    };

    // Write header line with restricted permissions
    writeFileSync(filePath, JSON.stringify(header) + '\n', { encoding: 'utf-8', mode: 0o600 });

    return { id, cwd, title: header.title, createdAt: now, updatedAt: now, messages: [], filePath };
}

// ─── Append new messages incrementally ───
// CC-style: each call writes only the NEW messages since last save.

export function appendMessages(session: Session, newMessages: Message[]): void {
    if (newMessages.length === 0) return;

    const now = new Date().toISOString();
    session.updatedAt = now;

    // Lazily update title from first user message
    if (session.title === 'Untitled session') {
        const title = extractTitle(newMessages);
        if (title !== 'Untitled session') {
            session.title = title;
            // Re-write header with updated title (header is always first line)
            rewriteHeader(session);
        }
    }

    const lines = newMessages.map((m) => JSON.stringify({ type: 'message', message: m, ts: now })).join('\n') + '\n';
    try {
        appendFileSync(session.filePath, lines, { encoding: 'utf-8', mode: 0o600 });
    } catch {
        // Non-fatal — session may be on read-only fs
    }
}

function rewriteHeader(session: Session): void {
    try {
        const content = readFileSync(session.filePath, 'utf-8');
        const lines = content.split('\n');
        if (lines.length === 0) return;
        const header: SessionHeader = {
            type: 'header',
            id: session.id,
            cwd: session.cwd,
            title: session.title,
            createdAt: session.createdAt,
            version: CURRENT_VERSION,
        };
        lines[0] = JSON.stringify(header);
        writeFileSync(session.filePath, lines.join('\n'), { encoding: 'utf-8', mode: 0o600 });
    } catch {
        // Non-fatal
    }
}

// ─── Save session (full sync — used on exit) ───

export function saveSession(session: Session): void {
    // Ensure all current messages are written
    // We track an internal cursor to avoid double-writes.
    // For simplicity: rewrite the whole file (only called on exit).
    const dir = getSessionsDir(session.cwd);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const now = new Date().toISOString();
    session.updatedAt = now;
    if (session.title === 'Untitled session') {
        session.title = extractTitle(session.messages);
    }

    const header: SessionHeader = {
        type: 'header',
        id: session.id,
        cwd: session.cwd,
        title: session.title,
        createdAt: session.createdAt,
        version: CURRENT_VERSION,
    };

    const lines: string[] = [JSON.stringify(header)];
    for (const m of session.messages) {
        lines.push(JSON.stringify({ type: 'message', message: m, ts: now }));
    }

    writeFileSync(session.filePath, lines.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
}

// ─── Load session by ID ───

export function loadSession(id: string, cwd: string): Session | null {
    const dir = getSessionsDir(cwd);
    const filePath = sessionFilePath(dir, id);
    return loadSessionFromFile(filePath);
}

function loadSessionFromFile(filePath: string): Session | null {
    if (!existsSync(filePath)) return null;
    try {
        const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
        if (lines.length === 0) return null;

        const header: SessionHeader = JSON.parse(lines[0]!);
        if (header.type !== 'header') return null;

        const messages: Message[] = [];
        for (const line of lines.slice(1)) {
            try {
                const entry = JSON.parse(line);
                if (entry.type === 'message' && entry.message) {
                    messages.push(entry.message);
                }
            } catch {
                // Skip malformed lines (CC does the same)
            }
        }

        const stat = statSync(filePath);
        return {
            id: header.id,
            cwd: header.cwd,
            title: header.title,
            createdAt: header.createdAt,
            updatedAt: stat.mtime.toISOString(),
            messages,
            filePath,
        };
    } catch {
        return null;
    }
}

// ─── Load latest session for a cwd (for --resume) ───

export function loadLatestSession(cwd: string): Session | null {
    const dir = getSessionsDir(cwd);
    if (!existsSync(dir)) return null;

    // Sort by mtime descending — newest first
    const files = readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

    for (const { name } of files) {
        const session = loadSessionFromFile(join(dir, name));
        if (session) return session;
    }
    return null;
}

// ─── List sessions for a cwd ───

export function listSessions(cwd: string, limit = 20): SessionMeta[] {
    const dir = getSessionsDir(cwd);
    if (!existsSync(dir)) return [];

    return readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
            const filePath = join(dir, f);
            try {
                const stat = statSync(filePath);
                const firstLine = readFirstLine(filePath);
                if (!firstLine) return null;
                const header: SessionHeader = JSON.parse(firstLine);
                if (header.type !== 'header') return null;

                // Count message lines (exclude header)
                const content = readFileSync(filePath, 'utf-8');
                const messageCount = content.split('\n').filter((l) => l.includes('"type":"message"')).length;

                return {
                    id: header.id,
                    cwd: header.cwd,
                    title: header.title,
                    createdAt: header.createdAt,
                    updatedAt: stat.mtime.toISOString(),
                    messageCount,
                };
            } catch {
                return null;
            }
        })
        .filter((s): s is SessionMeta => s !== null)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, limit);
}

function readFirstLine(filePath: string): string | null {
    try {
        const content = readFileSync(filePath, 'utf-8');
        return content.split('\n')[0] || null;
    } catch {
        return null;
    }
}

// ─── Cleanup on process exit ───
// Register a flush callback to call on SIGINT/SIGTERM.

let _cleanupSession: Session | null = null;
let _cleanupRegistered = false;

export function registerSessionCleanup(session: Session): void {
    _cleanupSession = session;
    if (_cleanupRegistered) return;
    _cleanupRegistered = true;

    const flush = () => {
        if (_cleanupSession) {
            try { saveSession(_cleanupSession); } catch { /* best-effort */ }
        }
    };

    process.on('exit', flush);
    process.on('SIGINT', () => { flush(); process.exit(0); });
    process.on('SIGTERM', () => { flush(); process.exit(0); });
}
