import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { useAgent } from './hooks/useAgent.js';
import { MessageList } from './components/MessageList.js';
import { StatusLine } from './components/StatusLine.js';
import { PromptInput } from './components/PromptInput.js';
import { ConfirmPrompt } from './components/ConfirmPrompt.js';
import type { ConfirmOption } from './components/ConfirmPrompt.js';
import type { Message, AgentMode, AutonomyLevel } from '../types.js';
import { handleSlashCommand } from './slash.js';
import { createProvider } from '../providers/registry.js';
import type { LLMProvider } from '../providers/base.js';
import { renderMarkdown } from '../ui/renderer.js';

interface AppProps {
    initialHistory: Message[];
    provider: any;
    tools: any;
    config: any;
    cwd: string;
    agentsMdContent?: string;
    skillDescriptions?: string[];
    agentDescriptions?: string[];
    confirmAction: (description: string) => Promise<string | boolean>;
    initialPrompt?: string;
    onSessionSave?: (messages: Message[]) => void;
    mcpConnections?: any[];
}

export function App(props: AppProps) {
    const { exit } = useApp();

    // Mutable runtime state for mode, autonomy, and provider
    const [mode, setMode] = useState<AgentMode>(props.config.mode);
    const [autonomy, setAutonomy] = useState<AutonomyLevel>(props.config.autonomy);
    const [provider, setProvider] = useState<LLMProvider>(props.provider);

    // ─── Ink-native confirmAction ───
    const [pendingConfirm, setPendingConfirm] = useState<{
        title: string;
        description?: string;
        options: ConfirmOption[];
    } | null>(null);
    const confirmResolveRef = useRef<((value: boolean | string) => void) | null>(null);

    const inkConfirmAction = useCallback(async (description: string): Promise<boolean | string> => {
        let title: string;
        let desc: string | undefined;
        let options: ConfirmOption[];

        if (description.startsWith('ASK_USER\n')) {
            try {
                const payload = JSON.parse(description.slice('ASK_USER\n'.length));
                title = payload.question;
                options = payload.options.map((opt: any, i: number) => ({
                    label: opt.label,
                    value: opt.label,
                    hint: opt.description || '',
                }));
                if (payload.allowCustom !== false) {
                    options.push({ label: 'Other (custom)', value: '__custom__', hint: 'type a custom answer' });
                }
                options.push({ label: 'Skip', value: '__skip__', hint: 'dismiss' });
            } catch {
                title = 'Action requires approval';
                desc = description;
                options = [
                    { label: 'Allow', value: 'allow', hint: 'proceed' },
                    { label: 'Deny', value: 'deny', hint: 'skip' },
                    { label: 'Edit', value: '__custom__', hint: 'provide feedback' },
                ];
            }
        } else if (description.startsWith('PLAN_APPROVAL\n')) {
            title = 'Plan Approval';
            try {
                const items = JSON.parse(description.slice('PLAN_APPROVAL\n'.length));
                desc = items.map((t: any, i: number) => `${i + 1}. ${t.content}`).join('\n');
            } catch {
                desc = description;
            }
            options = [
                { label: 'Approve', value: 'allow', hint: 'proceed with this plan' },
                { label: 'Reject', value: 'deny', hint: 'reject this plan' },
                { label: 'Edit', value: '__custom__', hint: 'suggest changes' },
            ];
        } else {
            title = 'Action requires approval';
            desc = description.split('\n').slice(0, 12).join('\n');
            options = [
                { label: 'Allow', value: 'allow', hint: 'proceed' },
                { label: 'Deny', value: 'deny', hint: 'skip' },
                { label: 'Edit', value: '__custom__', hint: 'provide feedback' },
            ];
        }

        return new Promise<boolean | string>((resolve) => {
            confirmResolveRef.current = resolve;
            setPendingConfirm({ title, description: desc, options });
        });
    }, []);

    const handleConfirmSelect = useCallback((value: string) => {
        setPendingConfirm(null);
        const resolve = confirmResolveRef.current;
        confirmResolveRef.current = null;
        if (!resolve) return;

        if (value === 'allow') {
            resolve(true);
        } else if (value === 'deny' || value === '__skip__') {
            resolve(false);
        } else {
            // Option label or custom text
            resolve(value);
        }
    }, []);

    // Build a live config that reflects current mode/autonomy
    const liveConfig = { ...props.config, mode, autonomy };

    const {
        messages, isBusy, streamedText, thinkingText, activeTool,
        tokenUsage, submitMessage, cancel, addSystemMessage, clearMessages, triggerCompact,
        inputHistory,
    } = useAgent({
        ...props,
        confirmAction: inkConfirmAction,
        config: liveConfig,
        provider,
        onSessionSave: props.onSessionSave,
    });

    const [initialFired, setInitialFired] = useState(false);

    useEffect(() => {
        if (props.initialPrompt && !initialFired) {
            setInitialFired(true);
            submitMessage(props.initialPrompt);
        }
    }, [props.initialPrompt, initialFired, submitMessage]);

    // Provider hot-swap helper
    const switchProvider = useCallback((modelName: string) => {
        try {
            const { getModel } = require('../store/models.js');
            const stored = getModel(modelName);
            if (!stored) {
                addSystemMessage(`Model "${modelName}" not found. Use /model list to see available models.`);
                return;
            }
            const newProvider = createProvider({
                type: stored.provider,
                model: stored.model,
                baseUrl: stored.baseUrl,
                apiKey: stored.apiKey,
                maxTokens: stored.maxTokens,
                useMaxCompletionTokens: stored.useMaxCompletionTokens,
                reasoningEffort: stored.reasoningEffort,
                thinkingBudget: stored.thinkingBudget,
            });
            setProvider(newProvider);
            addSystemMessage(`Switched to model "${modelName}" (${stored.provider}/${stored.model})`);
        } catch (err: any) {
            addSystemMessage(`Error switching model: ${err.message}`);
        }
    }, [addSystemMessage]);

    // Clipboard paste handler
    const handleClipboardPaste = useCallback(async (messageText?: string) => {
        try {
            const { loadImageFromClipboard } = await import('../ui/image.js');
            const base64Data = await loadImageFromClipboard();
            if (!base64Data) {
                addSystemMessage('No image found in clipboard.');
                return;
            }
            const content: any[] = [
                { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: base64Data } }
            ];
            if (messageText) content.push({ type: 'text', text: messageText });
            addSystemMessage('Pasted image from clipboard.');
            submitMessage(content);
        } catch (err: any) {
            addSystemMessage(`Error pasting image: ${err.message}`);
        }
    }, [addSystemMessage, submitMessage]);

    const handleInput = async (val: string) => {
        if (val.startsWith('/')) {
            await handleSlashCommand(val, {
                messagesLength: messages.length,
                cwd: props.cwd,
                addSystemMessage,
                clearMessages,
                submitMessage,
                triggerCompact: () => triggerCompact(provider),
                exitFunc: () => {
                    exit();
                    process.exit(0);
                },
                skillDescriptions: props.skillDescriptions,
                agentDescriptions: props.agentDescriptions,
                setMode,
                setAutonomy,
                switchProvider,
                mcpConnections: props.mcpConnections,
                handleClipboardPaste,
            });
            return;
        }
        submitMessage(val);
    };

    useInput((input, key) => {
        // Global escape to cancel mid-generation
        if (key.escape && isBusy) {
            cancel();
        }
        // Ctrl+C to exit completely
        if (input === 'c' && key.ctrl) {
            exit();
        }
        // Ctrl+V to paste image from clipboard
        if (input === 'v' && key.ctrl && !isBusy) {
            handleClipboardPaste();
        }
    });

    return (
        <Box flexDirection="column" width="100%">
            <Box marginBottom={1}>
                <Text bold color="cyan">Deepa</Text>
                <Text dimColor>{'  '}</Text>
                <Text color="blue">mode:</Text><Text bold color="cyan">{mode}</Text>
                <Text dimColor>{'  '}</Text>
                <Text color="blue">autonomy:</Text><Text bold color={autonomy === 'high' ? 'red' : autonomy === 'medium' ? 'yellow' : 'green'}>{autonomy}</Text>
                {tokenUsage.totalPrompt > 0 && (
                    <><Text dimColor>{'  '}</Text><Text dimColor>tokens: {(tokenUsage.totalPrompt + tokenUsage.totalCompletion).toLocaleString()}</Text></>
                )}
            </Box>

            <MessageList messages={messages} />

            {/* Display the active streamed text if generating */}
            {streamedText && (
                <Box paddingLeft={2} marginTop={1}>
                    <Text>{renderMarkdown(streamedText)}</Text>
                </Box>
            )}

            {pendingConfirm && (
                <ConfirmPrompt
                    title={pendingConfirm.title}
                    description={pendingConfirm.description}
                    options={pendingConfirm.options}
                    onSelect={handleConfirmSelect}
                />
            )}

            {isBusy && !pendingConfirm ? (
                <StatusLine thinkingText={thinkingText} activeTool={activeTool} tokenUsage={tokenUsage} />
            ) : !isBusy ? (
                <PromptInput onSubmit={handleInput} history={inputHistory} />
            ) : null}

            <Box marginTop={1}>
                <Text dimColor>ESC</Text><Text color="gray"> cancel  </Text>
                <Text dimColor>Ctrl+V</Text><Text color="gray"> paste  </Text>
                <Text dimColor>Ctrl+C</Text><Text color="gray"> exit  </Text>
                <Text dimColor>/help</Text><Text color="gray"> commands</Text>
            </Box>
        </Box>
    );
}
