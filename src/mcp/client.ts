// ─── MCP Client — connects to MCP servers, discovers tools ───
import { EventSource } from 'eventsource';
(global as any).EventSource = EventSource;

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolRegistry, Tool } from '../tools/registry.js';
import type { MCPServerConfig, ToolResult, ToolContext } from '../types.js';
import { z } from 'zod';

export interface MCPConnection {
    name: string;
    client: Client;
    transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
    tools: string[];
}

/**
 * Connect to all configured MCP servers and register their tools.
 */
export async function connectMCPServers(
    servers: Record<string, MCPServerConfig>,
    registry: ToolRegistry,
    verbose: boolean = false,
): Promise<MCPConnection[]> {
    const connections: MCPConnection[] = [];

    for (const [name, config] of Object.entries(servers)) {
        try {
            const connection = await connectMCPServer(name, config, registry, verbose);
            if (connection) {
                connections.push(connection);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (verbose) {
                console.error(`  ⚠ MCP server "${name}" failed to connect: ${msg}`);
            }
        }
    }

    return connections;
}

/**
 * Connect to a single MCP server via stdio transport.
 */
async function connectMCPServer(
    name: string,
    config: MCPServerConfig,
    registry: ToolRegistry,
    verbose: boolean,
): Promise<MCPConnection | null> {
    let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

    if (config.url) {
        if (config.transport === 'sse') {
            if (verbose) console.error(`  🔌 MCP server "${name}": connecting via standard SSE to ${config.url}`);
            transport = new SSEClientTransport(new URL(config.url));
        } else {
            // Default to newer Streamable HTTP for remote URLs (used by Mintlify / LangChain)
            if (verbose) console.error(`  🔌 MCP server "${name}": connecting via Streamable HTTP to ${config.url}`);
            transport = new StreamableHTTPClientTransport(new URL(config.url));
        }
    } else if (config.command) {
        if (verbose) console.error(`  🔌 MCP server "${name}": connecting via stdio`);
        transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
        });
    } else {
        if (verbose) console.error(`  ⚠ MCP server "${name}": no command or url specified, skipping`);
        return null;
    }

    const client = new Client(
        { name: 'deepa-cli', version: '0.1.0' },
        {},
    );

    await client.connect(transport);

    // Discover tools
    const toolsResult = await client.listTools();
    const toolNames: string[] = [];

    if (toolsResult.tools && toolsResult.tools.length > 0) {
        for (const mcpTool of toolsResult.tools) {
            const toolName = `mcp_${name}_${mcpTool.name}`;
            toolNames.push(toolName);

            // Create a wrapper tool that delegates to the MCP server
            const wrappedTool: Tool = {
                name: toolName,
                description: `[MCP: ${name}] ${mcpTool.description || mcpTool.name}`,
                parameters: z.record(z.unknown()), // Accept any params at validation level
                schemaOverride: mcpTool.inputSchema as Record<string, unknown> | undefined, // Pass true schema to provider Native schema
                riskLevel: 'medium', // Default to medium risk for MCP tools unless configured otherwise

                async execute(params: unknown, _context: ToolContext): Promise<ToolResult> {
                    try {
                        const result = await client.callTool({
                            name: mcpTool.name,
                            arguments: params as Record<string, unknown>,
                        });

                        // Extract text content from result
                        const contents = result.content as Array<{ type: string; text?: string }>;
                        const text = contents
                            .filter((c) => c.type === 'text' && c.text)
                            .map((c) => c.text)
                            .join('\n');

                        return { content: text || JSON.stringify(result.content) };
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        return { content: `MCP tool error: ${msg}`, isError: true };
                    }
                },
            };

            registry.register(wrappedTool);
        }

        if (verbose) {
            console.error(`  🔌 MCP "${name}": ${toolNames.length} tool(s) discovered`);
        }
    }

    return { name, client, transport, tools: toolNames };
}

/**
 * Disconnect all MCP servers gracefully.
 */
export async function disconnectMCPServers(connections: MCPConnection[]): Promise<void> {
    for (const conn of connections) {
        try {
            await conn.client.close();
        } catch {
            // Ignore close errors
        }
    }
}
