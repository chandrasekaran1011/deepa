// ─── Ink-native confirmation / question prompt ───
// Renders selectable options in the terminal using Ink's useInput.

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export interface ConfirmOption {
    label: string;
    value: string;
    hint?: string;
}

interface ConfirmPromptProps {
    title: string;
    description?: string;
    options: ConfirmOption[];
    onSelect: (value: string) => void;
}

export const ConfirmPrompt: React.FC<ConfirmPromptProps> = ({ title, description, options, onSelect }) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isTextInput, setIsTextInput] = useState(false);
    const [textValue, setTextValue] = useState('');

    useInput((input, key) => {
        if (isTextInput) {
            if (key.escape) {
                setIsTextInput(false);
                setTextValue('');
            }
            return; // TextInput handles the rest
        }

        if (key.upArrow) {
            setSelectedIndex((i) => (i - 1 + options.length) % options.length);
        } else if (key.downArrow) {
            setSelectedIndex((i) => (i + 1) % options.length);
        } else if (key.return) {
            const selected = options[selectedIndex];
            if (selected.value === '__custom__') {
                setIsTextInput(true);
            } else {
                onSelect(selected.value);
            }
        } else if (key.escape) {
            onSelect('deny');
        } else {
            // Number keys for quick selection (1-9)
            const num = parseInt(input);
            if (num >= 1 && num <= options.length) {
                const selected = options[num - 1];
                if (selected.value === '__custom__') {
                    setSelectedIndex(num - 1);
                    setIsTextInput(true);
                } else {
                    onSelect(selected.value);
                }
            }
        }
    });

    const handleTextSubmit = useCallback((value: string) => {
        if (value.trim()) {
            onSelect(value.trim());
        }
    }, [onSelect]);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
            <Text bold color="cyan">{title}</Text>
            {description && (
                <Box marginTop={1}>
                    <Text dimColor>{description}</Text>
                </Box>
            )}
            <Box flexDirection="column" marginTop={1}>
                {options.map((opt, i) => (
                    <Box key={opt.value}>
                        <Text color={i === selectedIndex ? 'cyan' : undefined}>
                            {i === selectedIndex ? '❯ ' : '  '}
                        </Text>
                        <Text bold={i === selectedIndex} color={i === selectedIndex ? 'white' : 'gray'}>
                            {opt.label}
                        </Text>
                        {opt.hint && (
                            <Text dimColor>  {opt.hint}</Text>
                        )}
                    </Box>
                ))}
            </Box>
            {isTextInput && (
                <Box marginTop={1}>
                    <Text color="cyan">{'❯ '}</Text>
                    <TextInput
                        value={textValue}
                        onChange={setTextValue}
                        onSubmit={handleTextSubmit}
                        placeholder="Type your answer..."
                    />
                </Box>
            )}
            <Box marginTop={1}>
                <Text dimColor>(↑↓ navigate, Enter select, Esc cancel)</Text>
            </Box>
        </Box>
    );
};
