import React, { useState, useEffect } from 'react';
import { ChevronUp, Settings, Sun, Moon, Monitor } from 'lucide-react';
import type { TokenUsage } from '../hooks/useAgent';

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
    mode: string;
    reasoning: string;
}

interface BottomControlsProps {
    onToggleSettings?: () => void;
    refreshKey?: number;
    tokenUsage?: TokenUsage;
}

export const BottomControls: React.FC<BottomControlsProps> = ({ onToggleSettings, refreshKey, tokenUsage }) => {
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

    const setMode = async (mode: string) => {
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode }),
            });
            if (res.ok) {
                await fetchStatus();
            }
        } catch {
            // ignore
        }
    };

    const setReasoning = async (level: string) => {
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reasoning: level }),
            });
            if (res.ok) {
                await fetchStatus();
            }
        } catch {
            // ignore
        }
    };

    // Theme management — hooks must be before any conditional returns
    const [theme, setTheme] = useState<'dark' | 'light' | 'auto'>(() => {
        return (localStorage.getItem('deepa-theme') as 'dark' | 'light' | 'auto') || 'dark';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('deepa-theme', theme);
    }, [theme]);

    if (!status) return null;

    const totalTokens = tokenUsage ? tokenUsage.totalPromptTokens + tokenUsage.totalCompletionTokens : 0;

    const cycleTheme = () => {
        setTheme(t => t === 'dark' ? 'light' : t === 'light' ? 'auto' : 'dark');
    };

    const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

    return (
        <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 mt-1.5 text-xs">

            {/* Model selector */}
            <div className="relative">
                <button
                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors"
                >
                    <span className="max-w-[80px] xs:max-w-[140px] truncate">{status.model}</span>
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

            {/* Separator — hidden on xs */}
            <span className="hidden xs:inline text-[var(--border)]">·</span>

            {/* Mode toggle */}
            <div className="flex items-center gap-1">
                <span className="hidden xs:inline text-[var(--text-muted)] font-medium uppercase tracking-wider text-[10px]">Mode</span>
                <div className="flex items-center rounded bg-[var(--bg-input)] border border-[var(--border)] overflow-hidden">
                    {['plan', 'exec'].map((m) => (
                        <button
                            key={m}
                            onClick={() => setMode(m)}
                            className={`px-2 py-1 transition-colors ${
                                status.mode === m
                                    ? 'bg-[var(--accent)]/20 text-[var(--accent)] font-semibold'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                            }`}
                            title={`Mode: ${m}`}
                        >
                            {m}
                        </button>
                    ))}
                </div>
            </div>

            {/* Separator — hidden on xs */}
            <span className="hidden xs:inline text-[var(--border)]">·</span>

            {/* Autonomy toggle */}
            <div className="flex items-center gap-1">
                <span className="hidden xs:inline text-[var(--text-muted)] font-medium uppercase tracking-wider text-[10px]">Autonomy</span>
                <div className="flex items-center rounded bg-[var(--bg-input)] border border-[var(--border)] overflow-hidden">
                    {['low', 'med', 'high'].map((level) => {
                        const fullLevel = level === 'med' ? 'medium' : level;
                        return (
                            <button
                                key={level}
                                onClick={() => setAutonomy(fullLevel)}
                                className={`px-2 py-1 transition-colors ${
                                    status.autonomy === fullLevel
                                        ? 'bg-[var(--accent)]/20 text-[var(--accent)] font-semibold'
                                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                }`}
                                title={`Autonomy: ${fullLevel} — ${fullLevel === 'low' ? 'all actions need approval' : fullLevel === 'medium' ? 'risky actions need approval' : 'minimal approvals'}`}
                            >
                                {level}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Separator — hidden on xs */}
            <span className="hidden xs:inline text-[var(--border)]">·</span>

            {/* Reasoning toggle — label hidden on xs, 'off' abbreviated to '·' on xs */}
            <div className="flex items-center gap-1">
                <span className="hidden xs:inline text-[var(--text-muted)] font-medium uppercase tracking-wider text-[10px]">Reasoning</span>
                <div className="flex items-center rounded bg-[var(--bg-input)] border border-[var(--border)] overflow-hidden">
                    {(['off', 'low', 'med', 'high'] as const).map((level) => {
                        const fullLevel = level === 'med' ? 'medium' : level;
                        return (
                            <button
                                key={level}
                                onClick={() => setReasoning(fullLevel)}
                                className={`px-2 py-1 transition-colors ${
                                    status.reasoning === fullLevel
                                        ? 'bg-[var(--accent)]/20 text-[var(--accent)] font-semibold'
                                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                }`}
                                title={`Reasoning: ${fullLevel}`}
                            >
                                {level}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Separator — hidden on xs */}
            <span className="hidden xs:inline text-[var(--border)]">·</span>

            {/* Theme toggle */}
            <button
                onClick={cycleTheme}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                title={`Theme: ${theme} (click to cycle)`}
            >
                <ThemeIcon size={13} />
            </button>

            {/* Token usage — hidden on xs */}
            {totalTokens > 0 && (
                <span className="hidden xs:inline text-[var(--text-muted)]" title={`Prompt: ${tokenUsage!.totalPromptTokens.toLocaleString()} · Completion: ${tokenUsage!.totalCompletionTokens.toLocaleString()}`}>
                    {totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens} tok
                </span>
            )}

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
