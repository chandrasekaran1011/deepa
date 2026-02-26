// ─── Core agentic loop ───
// think → act → verify, streaming output

import type { Message, ToolContext, ToolCallContent, ToolResultContent, DeepaConfig } from '../types.js';
import type { LLMProvider } from '../providers/base.js';
import { ToolRegistry } from '../tools/registry.js';
import { buildSystemPrompt } from './prompts.js';
import chalk from 'chalk';

export interface LoopOptions {
    provider: LLMProvider;
    tools: ToolRegistry;
    config: DeepaConfig;
    cwd: string;
    agentsMdContent?: string;
    memoryContent?: string;
    skillDescriptions?: string[];
    signal?: AbortSignal;
    onText?: (text: string) => void;
    onToolCall?: (name: string, args: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: string, isError: boolean) => void;
    /** Called after each LLM response with cumulative token counts */
    onTokenUsage?: (promptTokens: number, completionTokens: number, totalPrompt: number, totalCompletion: number) => void;
    confirmAction: (description: string) => Promise<boolean | string>;
}

const MAX_ITERATIONS = 50;

export async function runAgentLoop(
    userMessage: string,
    history: Message[],
    options: LoopOptions,
): Promise<Message[]> {
    const {
        provider,
        tools,
        config,
        cwd,
        agentsMdContent,
        memoryContent,
        skillDescriptions,
        signal,
        onText,
        onToolCall,
        onToolResult,
        onTokenUsage,
        confirmAction,
    } = options;

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
        mode: config.mode,
        agentsMdContent,
        memoryContent,
        skillDescriptions,
        cwd,
    });

    const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage },
    ];

    // Debug: log history state
    if (config.verbose) {
        const historySize = JSON.stringify(history).length;
        process.stderr.write(chalk.dim(`[loop] history: ${history.length} msgs, ~${(historySize / 1024).toFixed(1)}KB | total messages: ${messages.length}\n`));
    }

    const toolDefs = tools.getDefinitions();
    const toolContext: ToolContext = {
        cwd,
        autonomy: config.autonomy,
        confirmAction,
        log: (msg) => {
            if (config.verbose) {
                process.stderr.write(chalk.dim(msg) + '\n');
            }
        },
    };

    let iterations = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    while (iterations < MAX_ITERATIONS) {
        // Check abort before each iteration
        if (signal?.aborted) {
            messages.push({ role: 'assistant', content: '[Cancelled by user]' });
            return messages.slice(1);
        }

        iterations++;

        // Call LLM
        let fullText = '';
        const pendingToolCalls: Array<{ id: string; name: string; arguments: string; parsedArgs: Record<string, unknown>; parseError?: string }> = [];

        try {
            for await (const chunk of provider.chat(messages, toolDefs, undefined, signal)) {
                switch (chunk.type) {
                    case 'text':
                        fullText += chunk.text;
                        onText?.(chunk.text);
                        break;

                    case 'tool_call':
                        // Parse args once here — avoids duplicate JSON.parse below
                        {
                            let parsedArgs: Record<string, unknown>;
                            let parseError: string | undefined;
                            try {
                                parsedArgs = JSON.parse(chunk.arguments || '{}');
                            } catch (parseErr) {
                                const argLen = (chunk.arguments || '').length;
                                if (config.verbose) {
                                    const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
                                    const snippet = (chunk.arguments || '').slice(0, 200);
                                    process.stderr.write(chalk.dim(
                                        `[loop] JSON.parse failed for ${chunk.name}: ${errMsg}\n` +
                                        `[loop] raw args (first 200 chars): ${snippet}\n`,
                                    ));
                                }
                                parsedArgs = {};
                                parseError = `Tool call arguments were truncated (${argLen} chars of JSON, likely cut off by token limit). ` +
                                    `To fix: break the file into smaller chunks using file_write with append=true. ` +
                                    `First call: file_write with the first portion (append=false). ` +
                                    `Then call file_write with append=true for each remaining portion. ` +
                                    `Alternatively, write a script that generates the content and run it with shell.`;
                            }
                            pendingToolCalls.push({
                                id: chunk.id,
                                name: chunk.name,
                                arguments: chunk.arguments,
                                parsedArgs,
                                parseError,
                            });
                        }
                        break;

                    case 'error':
                        process.stderr.write(chalk.red(`\nLLM Error: ${chunk.error}\n`));
                        return messages.slice(1); // Remove system prompt

                    case 'done':
                        if (chunk.usage) {
                            totalPromptTokens += chunk.usage.promptTokens;
                            totalCompletionTokens += chunk.usage.completionTokens;
                            onTokenUsage?.(
                                chunk.usage.promptTokens,
                                chunk.usage.completionTokens,
                                totalPromptTokens,
                                totalCompletionTokens,
                            );
                        }
                        break;
                }
            }
        } catch (err) {
            // Graceful abort — user pressed Escape
            if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
                if (fullText) {
                    messages.push({ role: 'assistant', content: fullText + '\n\n[Cancelled by user]' });
                } else {
                    messages.push({ role: 'assistant', content: '[Cancelled by user]' });
                }
                return messages.slice(1);
            }

            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(chalk.red(`\nLLM Stream Error: ${msg}\n`));

            // If we already received some text or tool calls, we can proceed to save them.
            // Otherwise, we abort this turn.
            if (!fullText && pendingToolCalls.length === 0) {
                return messages.slice(1);
            }
        }

        // If no tool calls, we're done — assistant responded with text
        if (pendingToolCalls.length === 0) {
            messages.push({ role: 'assistant', content: fullText });
            return messages.slice(1); // Remove system prompt
        }

        // Build assistant message with tool calls (reuse already-parsed args)
        const assistantContent: (import('../types.js').TextContent | ToolCallContent)[] = [];
        if (fullText) {
            assistantContent.push({ type: 'text', text: fullText });
        }

        for (const tc of pendingToolCalls) {
            assistantContent.push({
                type: 'tool_call',
                id: tc.id,
                name: tc.name,
                arguments: tc.parsedArgs,
            });
        }

        messages.push({ role: 'assistant', content: assistantContent });

        // Execute tool calls (parsedArgs already available — no second JSON.parse)
        const toolResults: ToolResultContent[] = [];

        for (const tc of pendingToolCalls) {
            // Check abort before each tool execution
            if (signal?.aborted) {
                return messages.slice(1);
            }

            onToolCall?.(tc.name, tc.parsedArgs);

            let result;
            if (tc.parseError) {
                // Don't send empty params to registry — give the LLM actionable feedback
                result = { content: `Error: ${tc.parseError}`, isError: true as const };
            } else {
                result = await tools.execute(tc.name, tc.parsedArgs, toolContext);
            }

            onToolResult?.(tc.name, result.content, result.isError ?? false);

            toolResults.push({
                type: 'tool_result',
                toolCallId: tc.id,
                content: result.content,
                isError: result.isError,
            });
        }

        messages.push({ role: 'tool', content: toolResults });
    }

    // Max iterations reached
    process.stderr.write(chalk.yellow(`\n⚠ Max iterations (${MAX_ITERATIONS}) reached\n`));
    return messages.slice(1);
}
