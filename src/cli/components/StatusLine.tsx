import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalPrompt: number;
    totalCompletion: number;
}

interface StatusLineProps {
    thinkingText: string;
    activeTool: { name: string; args: any } | null;
    tokenUsage?: TokenUsage;
}

export function StatusLine({ thinkingText, activeTool, tokenUsage }: StatusLineProps) {
    const tokenInfo = tokenUsage && tokenUsage.totalPrompt > 0
        ? ` · ${(tokenUsage.totalPrompt + tokenUsage.totalCompletion).toLocaleString()} tokens`
        : '';

    if (activeTool) {
        return (
            <Box marginY={1}>
                <Text color="yellow">
                    <Spinner type="dots" /> Running tool: <Text bold>{activeTool.name}</Text>
                </Text>
                {tokenInfo && <Text dimColor>{tokenInfo}</Text>}
            </Box>
        );
    }

    if (thinkingText.trim().length > 0) {
        const preview = thinkingText.slice(0, 100).replace(/\n/g, ' ') + (thinkingText.length > 100 ? '...' : '');
        return (
            <Box marginY={1}>
                <Text dimColor>
                    <Spinner type="dots" /> {preview || "Thinking..."}
                </Text>
                {tokenInfo && <Text dimColor>{tokenInfo}</Text>}
            </Box>
        );
    }

    return (
        <Box marginY={1}>
            <Text color="blue">
                <Spinner type="dots" /> Thinking...
            </Text>
            {tokenInfo && <Text dimColor>{tokenInfo}</Text>}
        </Box>
    );
}
