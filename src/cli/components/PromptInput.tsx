import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface PromptInputProps {
    onSubmit: (value: string) => void;
    history?: string[];
}

export function PromptInput({ onSubmit, history = [] }: PromptInputProps) {
    const [query, setQuery] = useState('');
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [savedInput, setSavedInput] = useState('');

    useInput((_input, key) => {
        if (history.length === 0) return;

        if (key.upArrow) {
            const nextIdx = historyIndex + 1;
            if (nextIdx < history.length) {
                if (historyIndex === -1) setSavedInput(query);
                setHistoryIndex(nextIdx);
                setQuery(history[history.length - 1 - nextIdx]);
            }
        } else if (key.downArrow) {
            const nextIdx = historyIndex - 1;
            if (nextIdx >= 0) {
                setHistoryIndex(nextIdx);
                setQuery(history[history.length - 1 - nextIdx]);
            } else if (nextIdx === -1) {
                setHistoryIndex(-1);
                setQuery(savedInput);
            }
        }
    });

    return (
        <Box marginTop={1}>
            <Box marginRight={1}>
                <Text color="green" bold>❯</Text>
            </Box>
            <TextInput
                value={query}
                onChange={(val) => {
                    setQuery(val);
                    // Reset history browsing when user types
                    if (historyIndex !== -1) {
                        setHistoryIndex(-1);
                        setSavedInput('');
                    }
                }}
                onSubmit={(val) => {
                    const submission = val.trim();
                    if (submission) {
                        setQuery('');
                        setHistoryIndex(-1);
                        setSavedInput('');
                        onSubmit(submission);
                    }
                }}
            />
        </Box>
    );
}
