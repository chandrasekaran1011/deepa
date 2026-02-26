import * as React from 'react';
import { useState, useEffect } from 'react';

// Declare VS Code API provided by the webview environment
declare const acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

export const App = () => {
    const [messages, setMessages] = useState<{ role: string, text: string }[]>([]);
    const [input, setInput] = useState('');
    const [models, setModels] = useState<{ name: string, isDefault: boolean }[]>([]);
    const [selectedModel, setSelectedModel] = useState('');

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            console.log('Webview received message:', message);
            if (message.type === 'ready') {
                setModels(message.models || []);
                const defaultModel = message.models?.find((m: any) => m.isDefault);
                if (defaultModel) setSelectedModel(defaultModel.name);
            } else if (message.type === 'chat_started') {
                setMessages(prev => [...prev, { role: 'assistant', text: '' }]);
            } else if (message.type === 'chat_response') {
                setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                        last.text += message.text;
                    } else {
                        updated.push({ role: 'assistant', text: message.text });
                    }
                    return updated;
                });
            } else if (message.type === 'tool_event') {
                setMessages(prev => [...prev, { role: 'system', text: `Tool used: ${message.text}` }]);
            }
        };

        window.addEventListener('message', handleMessage);

        // Notify the extension host that we are ready to receive states
        vscode.postMessage({ type: 'webview_ready' });

        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const sendChat = () => {
        if (!input.trim()) return;
        setMessages(prev => [...prev, { role: 'user', text: input }]);
        vscode.postMessage({ type: 'send_chat', text: input, model: selectedModel });
        setInput('');
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '16px', boxSizing: 'border-box' }}>
            <div style={{ paddingBottom: '16px', borderBottom: '1px solid var(--vscode-panel-border)', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, fontWeight: 600, fontSize: '1.2rem' }}>Deepa Chat</h2>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {messages.length === 0 && (
                    <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}>
                        Type a message to start...
                    </div>
                )}
                {messages.map((m, i) => (
                    <div key={i} style={{
                        alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '85%',
                        padding: '12px 16px',
                        borderRadius: '8px',
                        lineHeight: 1.5,
                        backgroundColor: m.role === 'user' ? 'var(--vscode-button-background)' :
                            m.role === 'system' ? 'var(--vscode-editorError-background)' : 'var(--vscode-editorWidget-background)',
                        color: m.role === 'user' ? 'var(--vscode-button-foreground)' : 'var(--vscode-editor-foreground)',
                        border: m.role !== 'user' ? '1px solid var(--vscode-panel-border)' : 'none',
                        opacity: m.role === 'system' ? 0.8 : 1
                    }}>
                        <div style={{ fontSize: '0.8em', opacity: 0.7, marginBottom: '4px', textTransform: 'capitalize' }}>
                            {m.role === 'system' ? '🛠 Tool Output' : m.role}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {m.text}
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendChat()}
                        style={{
                            flex: 1,
                            padding: '10px 14px',
                            background: 'var(--vscode-input-background)',
                            color: 'var(--vscode-input-foreground)',
                            border: '1px solid var(--vscode-input-border)',
                            borderRadius: '4px',
                            fontSize: '13px'
                        }}
                        placeholder="Ask Deepa..."
                    />
                    <button
                        onClick={sendChat}
                        style={{
                            padding: '10px 16px',
                            background: 'var(--vscode-button-background)',
                            color: 'var(--vscode-button-foreground)',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 600
                        }}
                    >Send</button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>
                    <span>Deepa Assistant</span>
                    <select
                        value={selectedModel}
                        onChange={e => setSelectedModel(e.target.value)}
                        style={{
                            background: 'var(--vscode-dropdown-background)',
                            color: 'var(--vscode-dropdown-foreground)',
                            border: '1px solid var(--vscode-dropdown-border)',
                            padding: '2px 4px',
                            borderRadius: '3px',
                            fontSize: '11px'
                        }}
                    >
                        {models.length === 0 && <option value="">Loading...</option>}
                        {models.map(m => (
                            <option key={m.name} value={m.name}>
                                {m.name} {m.isDefault ? '(default)' : ''}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
};
