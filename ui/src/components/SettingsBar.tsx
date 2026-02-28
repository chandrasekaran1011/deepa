import React, { useState, useEffect } from 'react';
import { History, FolderOpen } from 'lucide-react';

interface ServerStatus {
    model: string;
    provider: string;
    autonomy: string;
    cwd: string;
}

interface SettingsBarProps {
    onToggleSessions?: () => void;
}

function formatCwd(fullPath: string): { parent: string; folder: string } {
    const parts = fullPath.split('/').filter(Boolean);
    const folder = parts.pop() || fullPath;
    if (parts.length > 2) {
        return { parent: '.../' + parts.slice(-2).join('/') + '/', folder };
    }
    const parent = parts.length > 0 ? '/' + parts.join('/') + '/' : '/';
    return { parent, folder };
}

export const SettingsBar: React.FC<SettingsBarProps> = ({ onToggleSessions }) => {
    const [status, setStatus] = useState<ServerStatus | null>(null);

    useEffect(() => {
        fetchStatus();
    }, []);

    const fetchStatus = async () => {
        try {
            const res = await fetch('/api/status');
            if (res.ok) {
                const data = await res.json();
                setStatus(data);
            }
        } catch {
            // ignore
        }
    };

    if (!status) return null;

    const cwd = formatCwd(status.cwd || '');

    return (
        <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-card)] border-b border-[var(--accent)]/20">
            {/* Left: Brand + Sessions */}
            <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1.5">
                    <span className="text-[var(--accent)] font-bold text-base">◆</span>
                    <span className="font-bold text-[var(--text)] text-base tracking-tight">Deepa</span>
                </div>
                {onToggleSessions && (
                    <button
                        onClick={onToggleSessions}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                        title="Session history"
                    >
                        <History size={14} />
                    </button>
                )}
            </div>

            {/* Right: CWD */}
            <div className="flex items-center gap-1.5 text-xs max-w-[50%]">
                <FolderOpen size={12} className="text-[var(--text-muted)] shrink-0" />
                <span className="truncate">
                    <span className="text-[var(--text-muted)]">{cwd.parent}</span>
                    <span className="text-[var(--text-secondary)] font-medium">{cwd.folder}</span>
                </span>
            </div>
        </div>
    );
};
