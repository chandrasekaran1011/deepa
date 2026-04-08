// ─── spawn_agent tool ───
// Delegates a self-contained task to a named subagent.
// Runs with full context isolation: fresh history, scoped tool registry, optional model override.

import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext, Message, ToolResultContent, ToolCallContent } from '../types.js';
import type { AgentRegistry } from '../plugins/agents.js';
import { readAgentBody } from '../plugins/agents.js';
import { ToolRegistry } from './registry.js';
import { runAgentLoop, MAX_SPAWN_DEPTH } from '../agent/loop.js';
import { loadSubagentMemory } from '../context/memory.js';
import type { LLMProvider } from '../providers/base.js';
import type { DeepaConfig } from '../types.js';
import { getModel } from '../store/models.js';
import { createProvider } from '../providers/registry.js';

const parameters = z.object({
    agent: z.string().describe('Name of the agent to spawn (from Available Agents list)'),
    task: z.string().describe(
        'Clear, self-contained task description for the subagent. ' +
        'If inherit_context is false, include all needed context explicitly.',
    ),
    inherit_context: z.boolean().optional().describe('If true, the subagent securely inherits the exact conversation history up to this point stripped of huge outputs for prompt caching.'),
});

/**
 * Factory: creates a spawn_agent tool bound to a specific AgentRegistry, full tool registry,
 * parent provider, and config. Each spawned subagent gets full context isolation.
 */
export function createSpawnAgentTool(
    agentRegistry: AgentRegistry,
    fullRegistry: ToolRegistry,
    parentProvider: LLMProvider,
    config: DeepaConfig,
): Tool {
    return {
        name: 'spawn_agent',
        description:
            'Delegate a self-contained task to a specialized subagent. ' +
            'The subagent runs in complete isolation — fresh context, scoped tools, optional different model. ' +
            'Use for: code review after edits, security scans, research, any task that returns a clean summary. ' +
            'Always pass all required context in the `task` string — the subagent cannot see the current conversation.',
        parameters,
        riskLevel: 'medium',

        async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
            const { agent: agentName, task, inherit_context } = params as z.infer<typeof parameters>;

            // ── 0. Recursion depth guard ──
            const currentDepth = context.spawnDepth ?? 0;
            if (currentDepth >= MAX_SPAWN_DEPTH) {
                return {
                    content: `Error: Maximum subagent nesting depth (${MAX_SPAWN_DEPTH}) reached. ` +
                        `Cannot spawn "${agentName}" at depth ${currentDepth}. ` +
                        `Perform this task directly instead of delegating.`,
                    isError: true,
                };
            }

            // ── 1. Look up agent definition ──
            const agentDef = agentRegistry.get(agentName);
            if (!agentDef) {
                const available = agentRegistry.list().map((a) => a.name).join(', ');
                return {
                    content: `Error: Agent "${agentName}" not found. Available agents: ${available || 'none'}`,
                    isError: true,
                };
            }

            context.log(`[spawn_agent] Starting subagent "${agentName}" | model: ${agentDef.model} | maxTurns: ${agentDef.maxTurns}`);

            // ── 2. Build scoped tool registry ──
            const scopedRegistry = new ToolRegistry();
            if (agentDef.tools === undefined) {
                // No restriction — clone all tools from parent registry
                for (const tool of fullRegistry.list()) {
                    scopedRegistry.register(tool);
                }
            } else {
                // Only allowed tools
                for (const toolName of agentDef.tools) {
                    const tool = fullRegistry.get(toolName);
                    if (tool) {
                        scopedRegistry.register(tool);
                    } else {
                        context.log(`[spawn_agent] Warning: tool "${toolName}" not found in registry, skipping`);
                    }
                }
            }

            // ── 3. Resolve provider ──
            let subProvider: LLMProvider = parentProvider;
            if (agentDef.model !== 'inherit') {
                const storedModel = getModel(agentDef.model);
                if (storedModel) {
                    try {
                        const providerType =
                            storedModel.provider === 'ollama' ||
                                storedModel.provider === 'lmstudio' ||
                                storedModel.provider === 'custom'
                                ? 'local'
                                : (storedModel.provider as 'openai' | 'anthropic');
                        subProvider = createProvider({
                            type: providerType,
                            apiKey: storedModel.apiKey,
                            baseUrl: storedModel.baseUrl,
                            model: storedModel.model,
                            maxTokens: storedModel.maxTokens,
                        });
                        context.log(`[spawn_agent] Using model "${agentDef.model}" (${storedModel.model})`);
                    } catch {
                        context.log(`[spawn_agent] Warning: could not create provider for "${agentDef.model}", using parent provider`);
                    }
                } else {
                    context.log(`[spawn_agent] Warning: stored model "${agentDef.model}" not found, using parent provider`);
                }
            }

            // ── 4. Prepare subagent config and read prompt body ──
            const agentPrompt = readAgentBody(agentDef);
            const subConfig: DeepaConfig = {
                ...config,
                mode: 'exec',
            };

            // ── 5. Build Forked Context (if enabled) ──
            let forkedHistory: Message[] = [];
            if (inherit_context && context.messages) {
                const MAX_STRING_CONTENT = 500; // Truncate large string-content messages
                forkedHistory = context.messages.map((msg) => {
                    // Truncate large string-content messages (e.g. big assistant text)
                    if (typeof msg.content === 'string') {
                        if (msg.content.length > MAX_STRING_CONTENT) {
                            return { ...msg, content: msg.content.slice(0, MAX_STRING_CONTENT) + '\n[...truncated for fork]' };
                        }
                        return msg;
                    }

                    const strippedContent = msg.content.map((block) => {
                        if (block.type === 'tool_result') {
                            return { ...block, content: '[Fork Processed - Available in Parent Context]' } as ToolResultContent;
                        }
                        // Strip large tool_call arguments (e.g. file_write with huge content)
                        if (block.type === 'tool_call') {
                            const args = block.arguments;
                            const argsStr = JSON.stringify(args);
                            if (argsStr.length > MAX_STRING_CONTENT) {
                                const stripped = { ...args };
                                // Remove content/code fields that tend to be huge
                                for (const key of ['content', 'code', 'body', 'data']) {
                                    if (key in stripped && typeof stripped[key] === 'string' && (stripped[key] as string).length > 200) {
                                        stripped[key] = '[...truncated for fork]';
                                    }
                                }
                                return { ...block, arguments: stripped } as ToolCallContent;
                            }
                        }
                        return block;
                    });

                    return { ...msg, content: strippedContent };
                });
            }

            // ── 6. Inject Subagent Memory ──
            let finalTaskCommand = task;
            const subagentMemory = loadSubagentMemory(agentName);
            if (subagentMemory) {
                finalTaskCommand += `\n\n=== YOUR ORGANISED MEMORY INDEX ===\n` +
                `You have a dedicated memory file at ~/.deepa/memory/agents/${agentName}/MEMORY.md.\n` +
                `Use your file_write tool to append new rules or knowledge to this file if needed. Current entries:\n\n${subagentMemory}\n`;
            }

            // ── 7. Run isolated agent loop ──
            const startTime = Date.now();
            let finalMessage = '';

            try {
                const messages = await runAgentLoop(
                    inherit_context ? `[FORK DIRECTIVE]\n${finalTaskCommand}` : finalTaskCommand,
                    forkedHistory, // Uses stripped history if inherit_context is true, else []
                    {
                        provider: subProvider,
                        tools: scopedRegistry,
                        config: subConfig,
                        cwd: context.cwd,
                        // Agent body becomes the project context — injected cleanly by buildSystemPrompt
                        agentsMdContent: agentPrompt || undefined,
                        confirmAction: context.confirmAction,
                        signal: context.signal, // propagate abort signal from parent
                        maxIterations: agentDef.maxTurns, // enforce agent-defined turn limit
                        spawnDepth: currentDepth + 1, // increment nesting depth
                        agentId: `${agentName}-${Date.now()}`, // isolate todo list from parent
                        onToolCall: (name, args) => {
                            context.log(`[spawn_agent:${agentName}] → ${name}(${JSON.stringify(args).slice(0, 100)})`);
                        },
                        onToolResult: (name, result, isError) => {
                            context.log(`[spawn_agent:${agentName}] ← ${name}: ${isError ? 'ERROR ' : ''}${result.slice(0, 80)}`);
                        },
                    },
                );

                // Extract the last assistant message as the subagent's result
                for (let i = messages.length - 1; i >= 0; i--) {
                    const msg = messages[i];
                    if (msg.role === 'assistant') {
                        if (typeof msg.content === 'string') {
                            finalMessage = msg.content;
                        } else if (Array.isArray(msg.content)) {
                            const textParts = msg.content
                                .filter((c) => c.type === 'text')
                                .map((c) => (c as { type: 'text'; text: string }).text)
                                .join('\n');
                            finalMessage = textParts;
                        }
                        break;
                    }
                }

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                context.log(`[spawn_agent] "${agentName}" completed in ${elapsed}s`);

                return {
                    content: finalMessage
                        ? `[Subagent: ${agentName}]\n\n${finalMessage}`
                        : `[Subagent: ${agentName}] completed with no output.`,
                };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return {
                    content: `[Subagent: ${agentName}] Error: ${msg}`,
                    isError: true,
                };
            }
        },
    };
}
