// ─── MCP server storage ───
// Stores MCP server configs in ~/.deepa/mcp.json

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';
import type { MCPServerConfig } from '../types.js';

const DEEPA_DIR = join(homedir(), '.deepa');
const MCP_FILE = join(DEEPA_DIR, 'mcp.json');

// ─── Zod schema ───────────────────────────────────────────────────────────────

export const MCPServerConfigSchema = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().url('url must be a valid URL').optional(),
    transport: z.enum(['stdio', 'sse', 'http']).optional(),
    enabled: z.boolean().optional(),
}).refine(
    data => data.command !== undefined || data.url !== undefined,
    { message: 'MCPServerConfig must have either "command" (stdio) or "url" (HTTP/SSE)' },
);

export type ValidatedMCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

/**
 * Validate a single MCPServerConfig object.
 * Returns { success, data } or { success: false, error }.
 */
export function validateMcpServerConfig(config: unknown): z.SafeParseReturnType<ValidatedMCPServerConfig, ValidatedMCPServerConfig> {
    return MCPServerConfigSchema.safeParse(config);
}

// ─── Internal store helpers ───────────────────────────────────────────────────

interface MCPStore {
    mcpServers: Record<string, MCPServerConfig>;
}

function ensureDir(): void {
    if (!existsSync(DEEPA_DIR)) {
        mkdirSync(DEEPA_DIR, { recursive: true });
    }
}

function loadMcpStore(): MCPStore {
    ensureDir();
    if (!existsSync(MCP_FILE)) return { mcpServers: {} };
    try {
        const raw = JSON.parse(readFileSync(MCP_FILE, 'utf-8')) as MCPStore;
        // Strip any entries that fail schema validation and warn to stderr.
        const validated: Record<string, MCPServerConfig> = {};
        for (const [name, cfg] of Object.entries(raw.mcpServers ?? {})) {
            const result = MCPServerConfigSchema.safeParse(cfg);
            if (result.success) {
                validated[name] = result.data;
            } else {
                console.error(`  ⚠ MCP config "${name}" is invalid and will be skipped: ${result.error.issues.map(i => i.message).join(', ')}`);
            }
        }
        return { mcpServers: validated };
    } catch {
        return { mcpServers: {} };
    }
}

function saveMcpStore(store: MCPStore): void {
    ensureDir();
    writeFileSync(MCP_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function loadProjectMcp(cwd: string): Record<string, MCPServerConfig> {
    const projectFile = join(cwd, '.deepa.json');
    if (!existsSync(projectFile)) return {};
    try {
        const data = JSON.parse(readFileSync(projectFile, 'utf-8'));
        const raw: Record<string, unknown> = data.mcpServers ?? {};
        const validated: Record<string, MCPServerConfig> = {};
        for (const [name, cfg] of Object.entries(raw)) {
            const result = MCPServerConfigSchema.safeParse(cfg);
            if (result.success) {
                validated[name] = result.data;
            } else {
                console.error(`  ⚠ Project MCP config "${name}" is invalid and will be skipped: ${result.error.issues.map(i => i.message).join(', ')}`);
            }
        }
        return validated;
    } catch {
        return {};
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Get all MCP servers (global + project-level merged, project overrides global). */
export function getAllMcpServers(cwd: string): Record<string, MCPServerConfig> {
    const global = loadMcpStore().mcpServers;
    const project = loadProjectMcp(cwd);
    return { ...global, ...project };
}

/** Add a global MCP server. Throws a Zod error if the config is invalid. */
export function addMcpServer(name: string, config: MCPServerConfig): void {
    const result = MCPServerConfigSchema.safeParse(config);
    if (!result.success) {
        throw new Error(`Invalid MCP server config: ${result.error.issues.map(i => i.message).join(', ')}`);
    }
    const store = loadMcpStore();
    store.mcpServers[name] = result.data;
    saveMcpStore(store);
}

/** Remove a global MCP server. Returns false if it didn't exist. */
export function removeMcpServer(name: string): boolean {
    const store = loadMcpStore();
    if (!(name in store.mcpServers)) return false;
    delete store.mcpServers[name];
    saveMcpStore(store);
    return true;
}

/** Disable a global MCP server (sets enabled: false). Returns false if not found. */
export function disableMcpServer(name: string): boolean {
    const store = loadMcpStore();
    if (!(name in store.mcpServers)) return false;
    store.mcpServers[name] = { ...store.mcpServers[name], enabled: false };
    saveMcpStore(store);
    return true;
}

/** Enable a global MCP server (sets enabled: true). Returns false if not found. */
export function enableMcpServer(name: string): boolean {
    const store = loadMcpStore();
    if (!(name in store.mcpServers)) return false;
    store.mcpServers[name] = { ...store.mcpServers[name], enabled: true };
    saveMcpStore(store);
    return true;
}

/** List global MCP servers. */
export function listMcpServers(): Record<string, MCPServerConfig> {
    return loadMcpStore().mcpServers;
}
