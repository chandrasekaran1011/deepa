// ─── Tool registry ───

import { z, ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDefinition, ToolResult, ToolContext } from '../types.js';
import { requiresConfirmation } from '../agent/autonomy.js';

/** Max characters returned by any single tool call to protect context window */
const MAX_TOOL_OUTPUT = 8_000;

export interface Tool {
    name: string;
    description: string;
    parameters: ZodSchema;
    schemaOverride?: Record<string, unknown>; // Use this raw JSON schema instead of parameters
    safetyLevel: 'safe' | 'cautious' | 'dangerous';
    execute(params: unknown, context: ToolContext): Promise<ToolResult>;
}

export class ToolRegistry {
    private tools = new Map<string, Tool>();

    register(tool: Tool): void {
        this.tools.set(tool.name, tool);
    }

    get(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    list(): Tool[] {
        return Array.from(this.tools.values());
    }

    getDefinitions(): ToolDefinition[] {
        return this.list().map((tool) => {
            // Use override if provided
            let parameters = tool.schemaOverride ? { ...tool.schemaOverride } : undefined;

            // Otherwise compile Zod schema
            if (!parameters) {
                parameters = zodToJsonSchema(tool.parameters, { target: 'openAi' }) as Record<string, unknown>;
            }

            // OpenAI strict schema requirements:
            if (typeof parameters === 'object' && parameters !== null) {
                // 1. Must be object type
                if (!('type' in parameters)) {
                    parameters.type = 'object';
                }
                // 2. Must have properties object (even if empty)
                if (parameters.type === 'object' && !('properties' in parameters)) {
                    parameters.properties = {};
                }
                // 3. Remove unsupported JSON schema fields that MCP servers might include
                delete parameters.$schema;
                delete parameters.additionalProperties;
            }

            return {
                name: tool.name,
                description: tool.description,
                parameters,
            };
        });
    }

    async execute(name: string, params: unknown, context: ToolContext): Promise<ToolResult> {
        const tool = this.tools.get(name);
        if (!tool) {
            return { content: `Error: Unknown tool "${name}"`, isError: true };
        }

        // Deep-coerce LLM outputs. Newer models (gpt-5.2 etc.) frequently send:
        //   - null for optional params → strip the key so Zod treats it as missing
        //   - objects/arrays where strings are expected → JSON.stringify
        // We fix this centrally so every tool benefits.
        let sanitised: unknown = params;
        if (typeof params === 'object' && params !== null) {
            const entries = Object.entries(params as Record<string, unknown>)
                .filter(([, v]) => v !== null && v !== undefined)   // strip nulls entirely
                .map(([k, v]) => {
                    if (typeof v === 'object') return [k, JSON.stringify(v)];
                    return [k, v];
                });
            sanitised = Object.fromEntries(entries);
        }

        // Log raw params for verbose debugging
        context.log(`[registry] ${name} raw params: ${JSON.stringify(params)}`);

        // Parse and validate params
        const parsed = tool.parameters.safeParse(sanitised);
        if (!parsed.success) {
            context.log(`[registry] ${name} validation failed: ${parsed.error.message}`);
            return {
                content: `Error: Invalid parameters for tool "${name}": ${parsed.error.message}`,
                isError: true,
            };
        }

        // Check autonomy using the shared requiresConfirmation function
        if (requiresConfirmation(context.autonomy, tool.safetyLevel)) {
            const response = await context.confirmAction(
                `Tool "${name}" wants to execute with params: ${JSON.stringify(parsed.data, null, 2)}`,
            );
            if (response === false) {
                return { content: 'Action cancelled by user.', isError: true };
            } else if (typeof response === 'string') {
                return { content: `Action denied. User provided feedback: "${response}"`, isError: true };
            }
        }

        let result: ToolResult;
        try {
            result = await tool.execute(parsed.data, context);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            return { content: `Error executing tool "${name}": ${errorMsg}`, isError: true };
        }

        // Truncate oversized tool output to protect the LLM context window
        if (result.content.length > MAX_TOOL_OUTPUT) {
            const truncated = result.content.slice(0, MAX_TOOL_OUTPUT);
            const omitted = result.content.length - MAX_TOOL_OUTPUT;
            result = {
                ...result,
                content: `${truncated}\n\n[Output truncated — ${omitted.toLocaleString()} characters omitted. Use file_read with line ranges to read specific sections.]`,
            };
        }

        return result;
    }
}

// Create and populate the default registry
export function createDefaultRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    // Import and register all built-in tools
    return registry;
}
