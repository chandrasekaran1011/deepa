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
        iterations++;

        // Call LLM
        let fullText = '';
        const pendingToolCalls: Array<{ id: string; name: string; arguments: string; parsedArgs: Record<string, unknown> }> = [];

        try {
            for await (const chunk of provider.chat(messages, toolDefs)) {
                switch (chunk.type) {
                    case 'text':
                        fullText += chunk.text;
                        onText?.(chunk.text);
                        break;

                    case 'tool_call':
                        // Parse args once here — avoids duplicate JSON.parse below
                        {
                            let parsedArgs: Record<string, unknown>;
                            try {
                                parsedArgs = JSON.parse(chunk.arguments || '{}');
                            } catch {
                                parsedArgs = {};
                            }
                            pendingToolCalls.push({
                                id: chunk.id,
                                name: chunk.name,
                                arguments: chunk.arguments,
                                parsedArgs,
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
            onToolCall?.(tc.name, tc.parsedArgs);

            const result = await tools.execute(tc.name, tc.parsedArgs, toolContext);

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
