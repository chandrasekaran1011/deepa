import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { Message } from '../types.js';

interface BootProps {
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

export async function bootInkApp(props: BootProps): Promise<void> {
    const { waitUntilExit } = render(<App {...props} />);
    await waitUntilExit();
}
