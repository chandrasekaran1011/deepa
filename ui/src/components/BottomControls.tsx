import React, { useState, useEffect } from 'react';
import { ChevronUp, Settings } from 'lucide-react';

interface ModelInfo {
    name: string;
    provider: string;
    model: string;
    isDefault: boolean;
}

interface ServerStatus {
    model: string;
    provider: string;
    autonomy: string;
}

interface BottomControlsProps {
    onToggleSettings?: () => void;
    refreshKey?: number;
}

export const BottomControls: React.FC<BottomControlsProps> = ({ onToggleSettings, refreshKey }) => {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [status, setStatus] = useState<ServerStatus | null>(null);
    const [showModelDropdown, setShowModelDropdown] = useState(false);

    useEffect(() => {
        fetchStatus();
        fetchModels();
    }, [refreshKey]);

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

    const fetchModels = async () => {
        try {
            const res = await fetch('/api/models');
            if (res.ok) {
                const data = await res.json();
                setModels(data.models || []);
            }
        } catch {
            // ignore
        }
    };

    const switchModel = async (modelName: string) => {
        setShowModelDropdown(false);
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: modelName }),
            });
            if (res.ok) {
                await fetchStatus();
            }
        } catch {
            // ignore
        }
    };

    const setAutonomy = async (level: string) => {
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ autonomy: level }),
            });
            if (res.ok) {
                await fetchStatus();
            }
        } catch {
            // ignore
        }
    };

    if (!status) return null;

    return (
        <div className="flex items-center justify-center gap-3 mt-1.5 text-xs">
            {/* Model selector */}
            <div className="relative">
                <button
                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors"
                >
                    <span className="max-w-[150px] truncate">{status.model}</span>
                    <ChevronUp size={10} />
                </button>

                {showModelDropdown && models.length > 0 && (
                    <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowModelDropdown(false)} />
                        <div className="absolute left-0 bottom-full mb-1 z-20 min-w-[180px] bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg overflow-hidden">
                            {models.map((m) => (
                                <button
                                    key={m.name}
                                    onClick={() => switchModel(m.name)}
                                    className={`w-full text-left px-3 py-2 hover:bg-[var(--bg-input)] transition-colors ${
                                        m.model === status.model ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'
                                    }`}
                                >
                                    <div className="font-medium">{m.name}</div>
                                    <div className="text-[10px] text-[var(--text-muted)]">{m.provider}/{m.model}</div>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Autonomy toggle */}
            <div className="flex items-center rounded bg-[var(--bg-input)] border border-[var(--border)] overflow-hidden">
                {['low', 'medium', 'high'].map((level) => (
                    <button
                        key={level}
                        onClick={() => setAutonomy(level)}
                        className={`px-2 py-1 transition-colors ${
                            status.autonomy === level
                                ? 'bg-[var(--accent)]/20 text-[var(--accent)] font-semibold'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                        }`}
                    >
                        {level}
                    </button>
                ))}
            </div>

            {/* Settings gear */}
            {onToggleSettings && (
                <button
                    onClick={onToggleSettings}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                    title="Settings"
                >
                    <Settings size={13} />
                </button>
            )}
        </div>
    );
};
