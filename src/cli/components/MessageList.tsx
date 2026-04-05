import React from 'react';
import { Box, Text } from 'ink';
import type { Message, MessageContent, ToolCallContent, ToolResultContent } from '../../types.js';
import { renderMarkdown } from '../../ui/renderer.js';

/** Strip <user_input> wrapper tags added for prompt injection protection */
function stripUserInputTags(text: string): string {
    return text.replace(/^<user_input>\n?/g, '').replace(/\n?<\/user_input>$/g, '');
}

interface MessageListProps {
    messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
    const displayMessages = messages.filter(m => m.role !== 'system');

    return (
        <Box flexDirection="column" gap={1}>
            {displayMessages.map((msg, idx) => (
                <MessageItem key={idx} message={msg} />
            ))}
        </Box>
    );
}

function MessageItem({ message }: { message: Message }) {
    // Tool result messages
    if (message.role === 'tool') {
        if (!Array.isArray(message.content)) return null;
        const results = message.content as ToolResultContent[];
        return (
            <Box flexDirection="column">
                {results.map((r, i) => (
                    <Box key={i} paddingLeft={4}>
                        <Text color={r.isError ? 'red' : 'gray'} dimColor>
                            {r.isError ? '✗ ' : '↳ '}
                            {truncate(r.content, 200)}
                        </Text>
                    </Box>
                ))}
            </Box>
        );
    }

    // Info messages
    if (message.role === 'info') {
        const text = typeof message.content === 'string' ? message.content : contentToText(message.content);
        return (
            <Box paddingLeft={2}>
                <Text color="cyan" dimColor>{text}</Text>
            </Box>
        );
    }

    // User / Assistant messages
    let roleColor = 'blue';
    let roleName = 'Deepa';

    if (message.role === 'user') {
        roleColor = 'green';
        roleName = 'User';
    }

    if (typeof message.content === 'string') {
        let displayText = message.role === 'user' ? stripUserInputTags(message.content) : message.content;
        if (message.role === 'assistant') displayText = renderMarkdown(displayText);
        return (
            <Box flexDirection="column">
                <Text color={roleColor} bold>{roleName}:</Text>
                <Box paddingLeft={2}>
                    <Text>{displayText}</Text>
                </Box>
            </Box>
        );
    }

    // Array content — may contain text, tool_call, image blocks
    const parts = message.content as MessageContent[];
    return (
        <Box flexDirection="column">
            <Text color={roleColor} bold>{roleName}:</Text>
            {parts.map((part, i) => {
                if (part.type === 'text') {
                    let displayText = message.role === 'user' ? stripUserInputTags(part.text) : part.text;
                    if (message.role === 'assistant') displayText = renderMarkdown(displayText);
                    return (
                        <Box key={i} paddingLeft={2}>
                            <Text>{displayText}</Text>
                        </Box>
                    );
                }
                if (part.type === 'tool_call') {
                    const tc = part as ToolCallContent;
                    return (
                        <Box key={i} paddingLeft={2}>
                            <Text color="yellow" dimColor>
                                ⚡ {tc.name}({truncate(JSON.stringify(tc.arguments), 120)})
                            </Text>
                        </Box>
                    );
                }
                if (part.type === 'image') {
                    return (
                        <Box key={i} paddingLeft={2}>
                            <Text dimColor>[Image]</Text>
                        </Box>
                    );
                }
                return null;
            })}
        </Box>
    );
}

function contentToText(content: MessageContent[]): string {
    return content.map(c => c.type === 'text' ? c.text : '[Image]').join('\n');
}

function truncate(text: string, max: number): string {
    const oneLine = text.replace(/\n/g, ' ');
    return oneLine.length > max ? oneLine.slice(0, max) + '...' : oneLine;
}
