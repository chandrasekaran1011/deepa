import React, { useState, useEffect } from 'react';
import { X, Plus, MessageSquare, Trash2 } from 'lucide-react';

interface SessionInfo {
    id: string;
    createdAt: string;
    updatedAt: string;
    cwd: string;
    messageCount: number;
    preview: string;
}

interface SessionPanelProps {
    isOpen: boolean;
    onClose: () => void;
    currentSessionId: string | null;
    onNewSession: () => void;
    onLoadSession: (id: string) => void;
}

export const SessionPanel: React.FC<SessionPanelProps> = ({
    isOpen,
    onClose,
    currentSessionId,
    onNewSession,
    onLoadSession,
}) => {
    const [sessions, setSessions] = useState<SessionInfo[]>([]);

    useEffect(() => {
        if (isOpen) {
            fetchSessions();
        }
    }, [isOpen]);

    const fetchSessions = async () => {
        try {
            const res = await fetch('/api/sessions');
            if (res.ok) {
                const data = await res.json();
                setSessions(data.sessions || []);
            }
        } catch {
            // ignore
        }
    };

    const deleteSession = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setSessions((prev) => prev.filter((s) => s.id !== id));
            }
        } catch {
            // ignore
        }
    };

    const handleNewSession = () => {
        onNewSession();
        onClose();
    };

    const handleLoadSession = (id: string) => {
        if (id !== currentSessionId) {
            onLoadSession(id);
        }
        onClose();
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return date.toLocaleDateString();
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />

            {/* Panel */}
            <div className="fixed top-0 left-0 bottom-0 z-40 w-72 bg-[var(--bg-card)] border-r border-[var(--border)] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                    <span className="font-bold text-sm text-[var(--text)]">Sessions</span>
                    <button
                        onClick={onClose}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* New session button */}
                <div className="px-3 py-2 border-b border-[var(--border)]">
                    <button
                        onClick={handleNewSession}
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors text-sm font-medium"
                    >
                        <Plus size={14} />
                        New Session
                    </button>
                </div>

                {/* Session list */}
                <div className="flex-1 overflow-y-auto">
                    {sessions.length === 0 ? (
                        <div className="px-4 py-8 text-center text-[var(--text-muted)] text-sm">
                            No sessions yet
                        </div>
                    ) : (
                        sessions.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => handleLoadSession(s.id)}
                                className={`w-full text-left px-4 py-3 border-b border-[var(--border)] hover:bg-[var(--bg-input)] transition-colors group ${
                                    s.id === currentSessionId ? 'bg-[var(--accent)]/5 border-l-2 border-l-[var(--accent)]' : ''
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <MessageSquare size={12} className="text-[var(--text-muted)] shrink-0" />
                                            <span className="text-xs text-[var(--text-muted)]">
                                                {formatDate(s.updatedAt)}
                                            </span>
                                            <span className="text-[10px] text-[var(--text-muted)]">
                                                ({s.messageCount} msgs)
                                            </span>
                                        </div>
                                        <p className="text-sm text-[var(--text-secondary)] truncate">
                                            {s.preview}
                                        </p>
                                    </div>
                                    {s.id !== currentSessionId && (
                                        <button
                                            onClick={(e) => deleteSession(s.id, e)}
                                            className="p-1 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--red)] transition-all shrink-0"
                                            title="Delete session"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    )}
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </>
    );
};
