// ─── MCP server storage ───
// Stores MCP server configs in ~/.deepa/mcp.json

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { MCPServerConfig } from '../types.js';

const DEEPA_DIR = join(homedir(), '.deepa');
const MCP_FILE = join(DEEPA_DIR, 'mcp.json');

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
    if (!existsSync(MCP_FILE)) {
        return { mcpServers: {} };
    }
    try {
        return JSON.parse(readFileSync(MCP_FILE, 'utf-8'));
    } catch {
        return { mcpServers: {} };
    }
}

function saveMcpStore(store: MCPStore): void {
    ensureDir();
    writeFileSync(MCP_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

// Also load project-level mcp config from .deepa.json
function loadProjectMcp(cwd: string): Record<string, MCPServerConfig> {
    const projectFile = join(cwd, '.deepa.json');
    if (!existsSync(projectFile)) return {};
    try {
        const data = JSON.parse(readFileSync(projectFile, 'utf-8'));
        return data.mcpServers || {};
    } catch {
        return {};
    }
}

/**
 * Get all MCP servers (global + project-level merged).
 */
export function getAllMcpServers(cwd: string): Record<string, MCPServerConfig> {
    const global = loadMcpStore().mcpServers;
    const project = loadProjectMcp(cwd);
    return { ...global, ...project }; // project overrides global
}

/**
 * Add a global MCP server.
 */
export function addMcpServer(name: string, config: MCPServerConfig): void {
    const store = loadMcpStore();
    store.mcpServers[name] = config;
    saveMcpStore(store);
}

/**
 * Remove a global MCP server.
 */
export function removeMcpServer(name: string): boolean {
    const store = loadMcpStore();
    if (!(name in store.mcpServers)) return false;
    delete store.mcpServers[name];
    saveMcpStore(store);
    return true;
}

/**
 * List global MCP servers.
 */
export function listMcpServers(): Record<string, MCPServerConfig> {
    return loadMcpStore().mcpServers;
}
