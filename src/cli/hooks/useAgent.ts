import { useState, useCallback, useRef } from 'react';
import { runAgentLoop } from '../../agent/loop.js';
import type { Message, MessageContent } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ToolRegistry } from '../../tools/registry.js';
import { loadInputHistory, appendToHistory, saveInputHistory } from '../../ui/history.js';

interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalPrompt: number;
    totalCompletion: number;
}

interface UseAgentProps {
    initialHistory: Message[];
    provider: LLMProvider;
    tools: ToolRegistry;
    config: any;
    cwd: string;
    agentsMdContent?: string;
    skillDescriptions?: string[];
    agentDescriptions?: string[];
    confirmAction: (description: string) => Promise<string | boolean>;
    onSessionSave?: (messages: Message[]) => void;
}

export function useAgent(props: UseAgentProps) {
    const { initialHistory, provider, tools, config, cwd, agentsMdContent, skillDescriptions, agentDescriptions, confirmAction, onSessionSave } = props;

    const [messages, setMessages] = useState<Message[]>(initialHistory);
    const [isBusy, setIsBusy] = useState(false);
    const [streamedText, setStreamedText] = useState('');
    const [thinkingText, setThinkingText] = useState('');
    const [activeTool, setActiveTool] = useState<{name: string, args: any} | null>(null);
    const [tokenUsage, setTokenUsage] = useState<TokenUsage>({ promptTokens: 0, completionTokens: 0, totalPrompt: 0, totalCompletion: 0 });

    // Input history for arrow-key navigation
    const [inputHistory] = useState<string[]>(() => loadInputHistory());

    const abortControllerRef = useRef<AbortController | null>(null);
    const messagesRef = useRef<Message[]>(initialHistory);
    const updateMessages = useCallback((newMsgs: Message[] | ((prev: Message[]) => Message[])) => {
        setMessages((prev) => {
            const next = typeof newMsgs === 'function' ? newMsgs(prev) : newMsgs;
            messagesRef.current = next;
            return next;
        });
    }, []);

    const submitMessage = useCallback(async (text: string | MessageContent[]) => {
        setIsBusy(true);
        setStreamedText('');
        setThinkingText('');
        setActiveTool(null);

        // Save text input to history
        if (typeof text === 'string') {
            const updated = appendToHistory(inputHistory, text);
            inputHistory.length = 0;
            inputHistory.push(...updated);
            saveInputHistory(inputHistory);
        }

        // Immediately show the user message in the UI so it's visible during processing
        const currentMessages = messagesRef.current;
        const userMsg: Message = { role: 'user', content: typeof text === 'string' ? text : text };
        updateMessages([...currentMessages, userMsg]);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const newHistory = await runAgentLoop(text, currentMessages, {
                provider,
                tools,
                config,
                cwd,
                agentsMdContent,
                skillDescriptions,
                agentDescriptions,
                confirmAction,
                signal: controller.signal,
                onText: (chunk) => {
                    setStreamedText((prev) => prev + chunk);
                    setThinkingText((prev) => prev + chunk);
                },
                onToolCall: (name, args) => {
                    setThinkingText('');
                    setActiveTool({ name, args });
                },
                onToolResult: (_name, _result, _isError) => {
                    setActiveTool(null);
                },
                onTokenUsage: (prompt, completion, totalPrompt, totalCompletion) => {
                    setTokenUsage({ promptTokens: prompt, completionTokens: completion, totalPrompt, totalCompletion });
                },
                onProgress: (msgs) => {
                    // Incremental save — persist after each tool round so progress survives crashes
                    updateMessages(msgs);
                    onSessionSave?.(msgs);
                },
            });

            updateMessages(newHistory);

            // Persist session after each completed loop
            onSessionSave?.(newHistory);
        } catch (err: any) {
            if (err.name === 'AbortError') {
                // User cancelled
            } else {
                console.error("Agent Loop Error:", err);
            }
            // Save whatever progress was made before the error
            const currentMessages = messagesRef.current;
            if (currentMessages.length > 0) {
                onSessionSave?.(currentMessages);
            }
        } finally {
            setIsBusy(false);
            setStreamedText('');
            setActiveTool(null);
            abortControllerRef.current = null;
        }
    }, [provider, tools, config, cwd, agentsMdContent, skillDescriptions, agentDescriptions, confirmAction, updateMessages, onSessionSave, inputHistory]);

    const cancel = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    }, []);

    const addSystemMessage = useCallback((text: string) => {
        updateMessages(prev => [...prev, { role: 'info', content: text }]);
    }, [updateMessages]);

    const clearMessages = useCallback(() => {
        updateMessages([]);
    }, [updateMessages]);

    const triggerCompact = useCallback(async (provider: any) => {
        setIsBusy(true);
        setThinkingText('Compacting conversation history...');
        try {
            const { compressConversationHistory } = await import('../../context/compression.js');
            const currentMessages = messagesRef.current;
            const compressed = await compressConversationHistory(currentMessages, provider, 0);
            updateMessages(compressed);
        } catch (e: any) {
            updateMessages(prev => [...prev, { role: 'info', content: `[Error Compacting]: ${e.message}` }]);
        } finally {
            setIsBusy(false);
            setThinkingText('');
        }
    }, [updateMessages]);

    return {
        messages,
        isBusy,
        streamedText,
        thinkingText,
        activeTool,
        tokenUsage,
        submitMessage,
        cancel,
        addSystemMessage,
        clearMessages,
        triggerCompact,
        inputHistory,
    };
}
