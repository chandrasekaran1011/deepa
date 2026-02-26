import * as readline from 'readline';
import { runAgentLoop } from '../agent/loop.js';
import { createSession, saveSession, loadLatestSession } from '../context/history.js';
import { listModels, getModel } from '../store/models.js';
import type { LLMProvider } from '../providers/base.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { DeepaConfig, Message } from '../types.js';

export interface IpcServerOptions {
    provider: LLMProvider;
    tools: ToolRegistry;
    config: DeepaConfig;
    cwd: string;
    agentsMdContent?: string;
    memoryContent?: string;
    skillDescriptions?: string[];
    resume?: boolean;
}

export async function startIpcServer(options: IpcServerOptions) {
    const { provider, tools, config, cwd, agentsMdContent, memoryContent, skillDescriptions, resume } = options;

    let session = resume ? (loadLatestSession(cwd) || createSession(cwd)) : createSession(cwd);
    let conversationHistory: Message[] = session.messages;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    const sendEvent = (type: string, data: any) => {
        console.log(JSON.stringify({ type, ...data }));
    };

    const models = listModels().map(m => ({ name: m.name, isDefault: m.isDefault }));
    sendEvent('ready', { sessionId: session.id, messageCount: conversationHistory.length, models });

    let pendingConfirmResolve: ((value: boolean) => void) | null = null;



    rl.on('line', async (line) => {
        if (!line.trim()) return;

        try {
            const request = JSON.parse(line);

            if (request.type === 'confirm_response') {
                if (pendingConfirmResolve) {
                    pendingConfirmResolve(request.approved === true);
                    pendingConfirmResolve = null;
                }
                return;
            }

            if (request.type === 'chat') {
                sendEvent('chat_started', {});

                // If user selected a specific model in the UI, override it
                let activeProvider = provider;
                if (request.model) {
                    const selectedModel = getModel(request.model);
                    if (selectedModel) {
                        const { createProvider } = await import('../providers/registry.js');
                        activeProvider = createProvider({
                            type: selectedModel.provider as any,
                            model: selectedModel.name,
                            apiKey: selectedModel.apiKey,
                            maxTokens: 4096
                        });
                    }
                }

                try {
                    conversationHistory = await runAgentLoop(request.text, conversationHistory, {
                        provider: activeProvider,
                        tools,
                        config,
                        cwd,
                        agentsMdContent,
                        memoryContent,
                        skillDescriptions,
                        confirmAction: async (desc) => {
                            if (config.autonomy === 'auto') return true;
                            sendEvent('tool_confirm_request', { description: desc });
                            return new Promise((resolve) => {
                                pendingConfirmResolve = resolve;
                            });
                        },
                        onText: (text) => sendEvent('text', { text }),
                        onToolCall: (name, args) => sendEvent('tool_call', { name, args }),
                        onToolResult: (name, result, isError) => sendEvent('tool_result', { name, result, isError }),
                        onTokenUsage: (promptTokens, completionTokens, totalPrompt, totalCompletion) => {
                            sendEvent('token_usage', { promptTokens, completionTokens, totalPrompt, totalCompletion });
                        }
                    });

                } catch (loopErr) {
                    sendEvent('error', { message: `Agent loop error: ${loopErr instanceof Error ? loopErr.message : String(loopErr)}` });
                }

                session.messages = conversationHistory;
                saveSession(session);
                sendEvent('chat_finished', {});
            }
        } catch (err) {
            sendEvent('error', { message: err instanceof Error ? err.message : String(err) });
        }
    });

    // Handle abrupt stream closes
    rl.on('close', () => {
        saveSession(session);
        process.exit(0);
    });
}
