import { useState, useEffect, useRef, useCallback } from 'react';

export interface AttachmentInfo {
    name: string;
    preview?: string; // data URL for images
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isStreaming?: boolean;
    toolCalls?: ToolCall[];
    attachments?: AttachmentInfo[];
}

export interface ToolCall {
    id: string;
    name: string;
    args: any;
    result?: string;
    status: 'pending' | 'success' | 'error';
}

export function useAgent() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [queueSize, setQueueSize] = useState(0);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [pendingConfirmation, setPendingConfirmation] = useState<{ description: string } | null>(null);

    const eventSourceRef = useRef<EventSource | null>(null);
    const currentMessageIdRef = useRef<string | null>(null);
    const messageQueueRef = useRef<{ text: string; files: File[] }[]>([]);

    // Load chat history on mount
    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        try {
            const res = await fetch('/api/chat/history');
            if (res.ok) {
                const data = await res.json();
                if (data.messages && data.messages.length > 0) {
                    setMessages(data.messages);
                }
                if (data.sessionId) {
                    setSessionId(data.sessionId);
                }
            }
        } catch {
            // ignore — fresh session
        }
    };

    // Initialize SSE connection
    useEffect(() => {
        connectSSE();
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, []);

    const connectSSE = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const es = new EventSource('/api/chat/stream');
        eventSourceRef.current = es;

        es.onopen = () => {
            setError(null);
        };

        es.onerror = () => {
            setTimeout(connectSSE, 3000);
        };

        es.addEventListener('message', (e) => {
            try {
                const data = JSON.parse(e.data);
                handleStreamEvent(data);
            } catch (err) {
                console.error('Error parsing SSE data:', err);
            }
        });
    }, []);

    const handleStreamEvent = (data: any) => {
        switch (data.type) {
            case 'start': {
                setIsProcessing(true);
                const newMsgId = data.id || Date.now().toString();
                currentMessageIdRef.current = newMsgId;
                setMessages((prev) => [
                    ...prev,
                    { id: newMsgId, role: 'assistant', content: '', isStreaming: true, toolCalls: [] }
                ]);
                break;
            }

            case 'text':
                if (!currentMessageIdRef.current) break;
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === currentMessageIdRef.current
                            ? { ...msg, content: msg.content + data.content }
                            : msg
                    )
                );
                break;

            case 'tool_call':
                if (!currentMessageIdRef.current) break;
                setMessages((prev) =>
                    prev.map((msg) => {
                        if (msg.id === currentMessageIdRef.current) {
                            const newToolCall: ToolCall = {
                                id: data.callId || Date.now().toString(),
                                name: data.name,
                                args: data.args,
                                status: 'pending'
                            };
                            return { ...msg, toolCalls: [...(msg.toolCalls || []), newToolCall] };
                        }
                        return msg;
                    })
                );
                break;

            case 'tool_result':
                if (!currentMessageIdRef.current) break;
                setMessages((prev) =>
                    prev.map((msg) => {
                        if (msg.id === currentMessageIdRef.current) {
                            const updatedToolCalls = (msg.toolCalls || []).map(tc => {
                                // Match by callId if available, otherwise by name + pending status
                                const matches = data.callId
                                    ? tc.id === data.callId
                                    : tc.name === data.name && tc.status === 'pending';
                                if (matches) {
                                    return { ...tc, status: data.isError ? 'error' as const : 'success' as const, result: data.result };
                                }
                                return tc;
                            });
                            return { ...msg, toolCalls: updatedToolCalls };
                        }
                        return msg;
                    })
                );
                break;

            case 'confirm_request':
                setPendingConfirmation({ description: data.description });
                break;

            case 'done':
                // Clear isStreaming on ALL messages (safety net for any stuck state)
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.isStreaming ? { ...msg, isStreaming: false } : msg
                    )
                );
                setIsProcessing(false);
                currentMessageIdRef.current = null;

                // Process queued messages
                if (messageQueueRef.current.length > 0) {
                    const next = messageQueueRef.current.shift()!;
                    setQueueSize(messageQueueRef.current.length);
                    doSendMessage(next.text, next.files);
                }
                break;

            case 'error':
                setError(data.error);
                setIsProcessing(false);
                if (currentMessageIdRef.current) {
                    setMessages((prev) =>
                        prev.map((msg) =>
                            msg.id === currentMessageIdRef.current
                                ? { ...msg, isStreaming: false }
                                : msg
                        )
                    );
                }
                currentMessageIdRef.current = null;
                break;
        }
    };

    const doSendMessage = async (text: string, files: File[] = []) => {
        setIsProcessing(true);
        setError(null);

        // Add user message to UI
        const userMsgId = Date.now().toString();
        const attachments: AttachmentInfo[] = [];
        for (const file of files) {
            if (file.type.startsWith('image/')) {
                const preview = await readFileAsDataURL(file);
                attachments.push({ name: file.name, preview });
            } else {
                attachments.push({ name: file.name });
            }
        }
        setMessages((prev) => [...prev, { id: userMsgId, role: 'user', content: text, attachments }]);

        try {
            const formData = new FormData();
            formData.append('message', text);
            for (const file of files) {
                formData.append('files', file);
            }

            const res = await fetch('/api/chat', {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                throw new Error(`Server error: ${res.status}`);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to send message');
            setIsProcessing(false);
        }
    };

    const sendMessage = async (text: string, files: File[] = []) => {
        if (!text.trim() && files.length === 0) return;

        // If already processing, queue the message
        if (isProcessing) {
            messageQueueRef.current.push({ text, files });
            setQueueSize(messageQueueRef.current.length);

            // Still show the queued user message in the thread
            const userMsgId = Date.now().toString();
            const attachments: AttachmentInfo[] = files.map(f => ({ name: f.name }));
            setMessages((prev) => [...prev, { id: userMsgId, role: 'user', content: text, attachments }]);
            return;
        }

        await doSendMessage(text, files);
    };

    const newSession = async () => {
        try {
            const res = await fetch('/api/sessions/new', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                setMessages([]);
                setSessionId(data.sessionId);
                setError(null);
            }
        } catch {
            // ignore
        }
    };

    const loadSession = async (id: string) => {
        try {
            const res = await fetch(`/api/sessions/${id}/load`, { method: 'POST' });
            if (res.ok) {
                setSessionId(id);
                await fetchHistory();
            }
        } catch {
            // ignore
        }
    };

    const respondToConfirmation = async (response: 'allow' | 'deny' | string) => {
        try {
            await fetch('/api/chat/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ response }),
            });
        } catch {
            // ignore
        }
        setPendingConfirmation(null);
    };

    const stopProcessing = async () => {
        try {
            await fetch('/api/chat/stop', { method: 'POST' });
        } catch {
            // ignore
        }
        setIsProcessing(false);
        if (currentMessageIdRef.current) {
            setMessages((prev) =>
                prev.map((msg) =>
                    msg.id === currentMessageIdRef.current
                        ? { ...msg, isStreaming: false }
                        : msg
                )
            );
        }
        currentMessageIdRef.current = null;
    };

    return {
        messages,
        sendMessage,
        isProcessing,
        error,
        stopProcessing,
        queueSize,
        sessionId,
        newSession,
        loadSession,
        pendingConfirmation,
        respondToConfirmation,
    };
}

function readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string || '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
    });
}
