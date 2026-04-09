// ─── Tool registry ───

import { z, ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ToolDefinition, ToolResult, ToolContext } from '../types.js';
import { requiresConfirmation } from '../agent/autonomy.js';
import { runHooks } from '../hooks/index.js';

/** Max characters returned by any single tool call to protect context window */
const MAX_TOOL_OUTPUT = 8_000;

export interface Tool {
    name: string;
    description: string | ((context: ToolContext) => string);
    parameters: ZodSchema;
    schemaOverride?: Record<string, unknown>; // Use this raw JSON schema instead of parameters
    riskLevel: 'low' | 'medium' | 'high' | 'very-high';
    
    // Tool lifecycle guards
    normalizeInput?: (params: unknown) => unknown;
    validateInput?: (params: unknown, context: ToolContext) => Promise<{valid: boolean; message?: string}>;
    maxOutputChars?: number;

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

    getDefinitions(context?: ToolContext): ToolDefinition[] {
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

            const resolvedDescription = typeof tool.description === 'function'
                ? (context ? tool.description(context) : '[dynamic description]')
                : tool.description;

            return {
                name: tool.name,
                description: resolvedDescription,
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

        // Apply tool's specific normalization if it exists
        if (tool.normalizeInput) {
            sanitised = tool.normalizeInput(sanitised);
        }

        if (typeof sanitised === 'object' && sanitised !== null) {
            const entries = Object.entries(sanitised as Record<string, unknown>)
                .filter(([, v]) => v !== null && v !== undefined)   // strip nulls entirely
                .map(([k, v]) => {
                    // Stringify plain objects (e.g. LLM sends {foo:1} for a string param)
                    // but preserve arrays — tools like todo accept array params directly
                    if (typeof v === 'object' && !Array.isArray(v)) return [k, JSON.stringify(v)];
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

        // Run pre-execution validation
        if (tool.validateInput) {
            const validation = await tool.validateInput(parsed.data, context);
            if (!validation.valid) {
                context.log(`[registry] ${name} validation rejected: ${validation.message}`);
                return {
                    content: `Error: Pre-flight validation failed for "${name}": ${validation.message ?? 'Unknown reason.'}`,
                    isError: true,
                }
            }
        }

        // ─── PreToolUse hooks ───
        if (context.hooksConfig) {
            const hookEnv = {
                tool_name: name,
                tool_input: JSON.stringify(parsed.data),
                cwd: context.cwd,
            };
            const hookResult = runHooks('PreToolUse', context.hooksConfig, hookEnv, context.cwd);
            if (hookResult.block) {
                return {
                    content: `Tool blocked by PreToolUse hook: ${hookResult.errorMessage ?? name}`,
                    isError: true,
                };
            }
            // Prepend hook context to assist the model — done via tool result injection
            // (caller in loop.ts will see this in the tool result)
        }

        // Check autonomy using the shared requiresConfirmation function
        if (requiresConfirmation(context.autonomy, tool.riskLevel)) {
            const response = await context.confirmAction(
                `Tool "${name}" wants to execute with params: ${JSON.stringify(parsed.data, null, 2)}`,
            );
            if (response === false) {
                // Denial tracking — increment counter and possibly downgrade autonomy
                context.denialTracker?.onDenial();
                return { content: 'Action cancelled by user.', isError: true };
            } else if (typeof response === 'string') {
                context.denialTracker?.onDenial();
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

        // ─── PostToolUse hooks ───
        if (context.hooksConfig) {
            const hookEnv = {
                tool_name: name,
                tool_input: JSON.stringify(parsed.data),
                tool_result: JSON.stringify({ content: result.content.slice(0, 500), isError: result.isError }),
                cwd: context.cwd,
            };
            const hookResult = runHooks('PostToolUse', context.hooksConfig, hookEnv, context.cwd);
            if (hookResult.contextMessage) {
                result = {
                    ...result,
                    content: `${result.content}\n\n[Hook context]: ${hookResult.contextMessage}`,
                };
            }
        }

        // ─── Tool result disk offload for large results ───
        const OFFLOAD_THRESHOLD = 4_000;
        const limit = tool.maxOutputChars ?? MAX_TOOL_OUTPUT;

        // Only offload results that are large but still within the truncation limit.
        // Results exceeding `limit` fall through to normal truncation below.
        if (result.content.length > OFFLOAD_THRESHOLD && result.content.length <= limit && !result.isError) {
            try {
                const offloadDir = join(tmpdir(), '.deepa', 'tool-results');
                if (!existsSync(offloadDir)) mkdirSync(offloadDir, { recursive: true });
                const offloadFile = join(offloadDir, `${name}_${Date.now()}.txt`);
                writeFileSync(offloadFile, result.content, 'utf-8');

                const preview = result.content.slice(0, 500);
                const total = result.content.length;
                result = {
                    ...result,
                    content: `${preview}\n\n[Full result (${Math.round(total / 1024)}KB) saved to: ${offloadFile}. Use file_read to access the complete output.]`,
                };
            } catch {
                // Fallback to normal truncation below
            }
        }

        // Truncate oversized tool output to protect the LLM context window
        if (result.content.length > limit) {
            const truncated = result.content.slice(0, limit);
            const omitted = result.content.length - limit;
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
