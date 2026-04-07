// ─── MCP Client — connects to MCP servers, discovers tools/resources/prompts ───
import { EventSource } from 'eventsource';
(global as any).EventSource = EventSource;

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ToolRegistry, Tool } from '../tools/registry.js';
import type { MCPServerConfig, ToolResult, ToolContext } from '../types.js';
import { z } from 'zod';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum characters allowed in an MCP tool/resource/prompt description. */
export const MAX_DESCRIPTION_LENGTH = 2048;

/** JSON-RPC error code indicating a session has expired (used by Streamable HTTP servers). */
const MCP_SESSION_EXPIRED_CODE = -32001;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MCPConnection {
    name: string;
    client: Client;
    tools: string[];
    enabled: boolean;
}

// Mutable wrapper so execute closures can swap the client on reconnect.
interface ClientRef {
    current: Client;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize a name to safe chars: [a-zA-Z0-9_-], max 64 chars.
 * Dots, spaces, slashes, etc. become underscores.
 */
export function normalizeMcpName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/**
 * Return true if the error represents a session-expired condition
 * (JSON-RPC error code -32001 or equivalent message patterns).
 */
export function isSessionExpiredError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const anyErr = err as any;
    if (anyErr.code === MCP_SESSION_EXPIRED_CODE) return true;
    const msg = err.message.toLowerCase();
    return msg.includes('-32001') || (msg.includes('session') && msg.includes('expir'));
}

/**
 * Build a fresh transport from a server config (used for reconnect).
 */
function buildTransport(
    config: MCPServerConfig,
): StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport {
    if (config.url) {
        return config.transport === 'sse'
            ? new SSEClientTransport(new URL(config.url))
            : new StreamableHTTPClientTransport(new URL(config.url));
    }
    return new StdioClientTransport({
        command: config.command!,
        args: config.args,
        env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    });
}

/**
 * Extract human-readable text from an MCP result content array.
 * - text items are concatenated as-is
 * - image items are saved to a temp file; a reference path is returned
 * - anything else is JSON-stringified
 */
export function extractMcpContent(resultContent: unknown): string {
    if (!Array.isArray(resultContent)) return JSON.stringify(resultContent);

    const parts: string[] = [];

    for (const c of resultContent as Array<{ type: string; text?: string; data?: string; mimeType?: string; uri?: string }>) {
        if (c.type === 'text' && c.text) {
            parts.push(c.text);
        } else if (c.type === 'image' && c.data) {
            try {
                const ext = ((c.mimeType ?? 'image/png').split('/')[1] ?? 'png').replace(/[^a-z0-9]/g, '');
                const tmpFile = join(tmpdir(), `deepa-mcp-${Date.now()}.${ext}`);
                const buf = Buffer.from(c.data, 'base64');
                writeFileSync(tmpFile, buf);
                parts.push(`[Image saved: ${tmpFile} (${buf.length} bytes, ${c.mimeType ?? 'image/png'})]`);
            } catch {
                // Fallback: report size only — don't embed raw base64 into LLM context
                const approxBytes = Math.round((c.data.length * 3) / 4);
                parts.push(`[Image: ${c.mimeType ?? 'image'}, ~${approxBytes} bytes — could not save to disk]`);
            }
        } else if (c.type === 'resource') {
            parts.push(JSON.stringify(c));
        } else {
            parts.push(JSON.stringify(c));
        }
    }

    return parts.join('\n') || JSON.stringify(resultContent);
}

/**
 * Create a tool execute function that calls an MCP tool by name.
 * Automatically reconnects and retries once on session expiry (-32001).
 */
function makeToolExecute(
    mcpToolName: string,
    clientRef: ClientRef,
    config: MCPServerConfig,
): (params: unknown, context: ToolContext) => Promise<ToolResult> {
    return async (params: unknown): Promise<ToolResult> => {
        const invoke = (c: Client) =>
            c.callTool({ name: mcpToolName, arguments: params as Record<string, unknown> })
                .then(r => extractMcpContent(r.content));

        try {
            return { content: await invoke(clientRef.current) };
        } catch (err) {
            if (isSessionExpiredError(err)) {
                try {
                    const fresh = new Client({ name: 'deepa-cli', version: '0.1.0' }, {});
                    await fresh.connect(buildTransport(config));
                    clientRef.current = fresh;
                    return { content: await invoke(fresh) };
                } catch (retryErr) {
                    const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                    return { content: `MCP tool error (after reconnect): ${msg}`, isError: true };
                }
            }
            const msg = err instanceof Error ? err.message : String(err);
            return { content: `MCP tool error: ${msg}`, isError: true };
        }
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Connect to all configured MCP servers in parallel and register their
 * tools, resources, and prompts into the tool registry.
 */
export async function connectMCPServers(
    servers: Record<string, MCPServerConfig>,
    registry: ToolRegistry,
    verbose: boolean = false,
): Promise<MCPConnection[]> {
    // Skip servers that have been explicitly disabled.
    const active = Object.entries(servers).filter(([, cfg]) => cfg.enabled !== false);

    const results = await Promise.allSettled(
        active.map(([name, config]) => connectMCPServer(name, config, registry, verbose)),
    );

    const connections: MCPConnection[] = [];
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const name = active[i][0];
        if (r.status === 'fulfilled' && r.value) {
            connections.push(r.value);
        } else if (r.status === 'rejected') {
            const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
            if (verbose) console.error(`  ⚠ MCP server "${name}" failed to connect: ${msg}`);
        }
    }

    return connections;
}

/**
 * Connect to one MCP server and register all its tools, resources, and prompts.
 */
async function connectMCPServer(
    name: string,
    config: MCPServerConfig,
    registry: ToolRegistry,
    verbose: boolean,
): Promise<MCPConnection | null> {
    if (!config.command && !config.url) {
        if (verbose) console.error(`  ⚠ MCP server "${name}": no command or url — skipping`);
        return null;
    }

    const normName = normalizeMcpName(name);

    if (verbose) {
        const via = config.url
            ? (config.transport === 'sse' ? `SSE → ${config.url}` : `HTTP → ${config.url}`)
            : 'stdio';
        console.error(`  🔌 MCP "${name}": connecting via ${via}`);
    }

    const client = new Client({ name: 'deepa-cli', version: '0.1.0' }, {});
    await client.connect(buildTransport(config));

    const clientRef: ClientRef = { current: client };
    const toolNames: string[] = [];

    // ── 1. Tools ─────────────────────────────────────────────────────────────
    const toolsResult = await client.listTools();
    for (const mcpTool of toolsResult.tools ?? []) {
        const toolName = `mcp_${normName}_${normalizeMcpName(mcpTool.name)}`;
        toolNames.push(toolName);

        const rawDesc = (mcpTool.description ?? mcpTool.name).slice(0, MAX_DESCRIPTION_LENGTH);

        registry.register({
            name: toolName,
            description: `[MCP: ${name}] ${rawDesc}`,
            parameters: z.record(z.unknown()),
            schemaOverride: mcpTool.inputSchema as Record<string, unknown> | undefined,
            riskLevel: 'medium',
            execute: makeToolExecute(mcpTool.name, clientRef, config),
        } as Tool);
    }
    if (verbose && toolsResult.tools?.length) {
        console.error(`  🔌 MCP "${name}": ${toolsResult.tools.length} tool(s)`);
    }

    // ── 2. Resources ──────────────────────────────────────────────────────────
    try {
        const resourcesResult = await client.listResources();
        if (resourcesResult.resources?.length) {
            // list_resources tool
            const listName = `mcp_${normName}_list_resources`;
            toolNames.push(listName);
            registry.register({
                name: listName,
                description: `[MCP: ${name}] List available resources`.slice(0, MAX_DESCRIPTION_LENGTH),
                parameters: z.object({}),
                riskLevel: 'low',
                async execute(): Promise<ToolResult> {
                    try {
                        const r = await clientRef.current.listResources();
                        return { content: JSON.stringify(r.resources, null, 2) };
                    } catch (err) {
                        return { content: `MCP error: ${err instanceof Error ? err.message : err}`, isError: true };
                    }
                },
            } as Tool);

            // read_resource tool
            const readName = `mcp_${normName}_read_resource`;
            toolNames.push(readName);
            registry.register({
                name: readName,
                description: `[MCP: ${name}] Read a resource by URI`.slice(0, MAX_DESCRIPTION_LENGTH),
                parameters: z.object({ uri: z.string().describe('Resource URI to read') }),
                riskLevel: 'low',
                async execute(params: unknown): Promise<ToolResult> {
                    try {
                        const { uri } = params as { uri: string };
                        const r = await clientRef.current.readResource({ uri });
                        return { content: extractMcpContent(r.contents) };
                    } catch (err) {
                        return { content: `MCP error: ${err instanceof Error ? err.message : err}`, isError: true };
                    }
                },
            } as Tool);

            if (verbose) console.error(`  🔌 MCP "${name}": ${resourcesResult.resources.length} resource(s)`);
        }
    } catch {
        // Server doesn't support resources — skip silently.
    }

    // ── 3. Prompts ────────────────────────────────────────────────────────────
    try {
        const promptsResult = await client.listPrompts();
        for (const prompt of promptsResult.prompts ?? []) {
            const promptTool = `mcp_${normName}_prompt_${normalizeMcpName(prompt.name)}`;
            toolNames.push(promptTool);
            const rawDesc = (prompt.description ?? prompt.name).slice(0, MAX_DESCRIPTION_LENGTH);
            registry.register({
                name: promptTool,
                description: `[MCP Prompt: ${name}] ${rawDesc}`,
                parameters: z.record(z.string()),
                riskLevel: 'low',
                async execute(params: unknown): Promise<ToolResult> {
                    try {
                        const r = await clientRef.current.getPrompt({
                            name: prompt.name,
                            arguments: params as Record<string, string>,
                        });
                        const text = (r.messages ?? [])
                            .map((m: any) => {
                                if (typeof m.content === 'string') return m.content;
                                if (Array.isArray(m.content)) return extractMcpContent(m.content);
                                return m.content?.text ?? JSON.stringify(m.content);
                            })
                            .join('\n');
                        return { content: text };
                    } catch (err) {
                        return { content: `MCP prompt error: ${err instanceof Error ? err.message : err}`, isError: true };
                    }
                },
            } as Tool);
        }
        if (verbose && promptsResult.prompts?.length) {
            console.error(`  🔌 MCP "${name}": ${promptsResult.prompts.length} prompt(s)`);
        }
    } catch {
        // Server doesn't support prompts — skip silently.
    }

    return { name, client, tools: toolNames, enabled: true };
}

/**
 * Disconnect all MCP servers gracefully.
 */
export async function disconnectMCPServers(connections: MCPConnection[]): Promise<void> {
    await Promise.allSettled(connections.map(c => c.client.close()));
}
