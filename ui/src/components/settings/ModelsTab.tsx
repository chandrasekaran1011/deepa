import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Star, X, ChevronDown } from 'lucide-react';

interface ModelInfo {
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    maxTokens: number;
    apiKeyMasked?: string;
    isDefault: boolean;
}

interface ProviderPreset {
    baseUrl: string;
    needsKey: boolean;
    defaultModel: string;
}

interface ModelsTabProps {
    isOpen: boolean;
}

export const ModelsTab: React.FC<ModelsTabProps> = ({ isOpen }) => {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [presets, setPresets] = useState<Record<string, ProviderPreset>>({});
    const [showForm, setShowForm] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [provider, setProvider] = useState('openai');
    const [model, setModel] = useState('');
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [maxTokens, setMaxTokens] = useState(16384);
    const [isDefault, setIsDefault] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchModels();
            fetchPresets();
        }
    }, [isOpen]);

    const fetchModels = async () => {
        try {
            const res = await fetch('/api/models');
            if (res.ok) {
                const data = await res.json();
                setModels(data.models || []);
            }
        } catch { /* ignore */ }
    };

    const fetchPresets = async () => {
        try {
            const res = await fetch('/api/provider-presets');
            if (res.ok) {
                const data = await res.json();
                setPresets(data);
            }
        } catch { /* ignore */ }
    };

    const applyPreset = (prov: string) => {
        setProvider(prov);
        const preset = presets[prov];
        if (preset) {
            setBaseUrl(preset.baseUrl);
            setModel(preset.defaultModel);
        }
    };

    const resetForm = () => {
        setName('');
        setProvider('openai');
        setModel('');
        setBaseUrl('');
        setApiKey('');
        setMaxTokens(16384);
        setIsDefault(false);
        setError(null);
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!name.trim() || !model.trim() || !baseUrl.trim()) {
            setError('Name, model, and base URL are required');
            return;
        }
        try {
            const res = await fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), provider, model: model.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey || undefined, maxTokens, isDefault }),
            });
            if (res.ok) {
                resetForm();
                setShowForm(false);
                await fetchModels();
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to add model');
            }
        } catch {
            setError('Failed to add model');
        }
    };

    const handleDelete = async (modelName: string) => {
        try {
            const res = await fetch(`/api/models/${encodeURIComponent(modelName)}`, { method: 'DELETE' });
            if (res.ok) {
                setConfirmDelete(null);
                await fetchModels();
            }
        } catch { /* ignore */ }
    };

    const handleSetDefault = async (modelName: string) => {
        try {
            const res = await fetch(`/api/models/${encodeURIComponent(modelName)}/default`, { method: 'POST' });
            if (res.ok) await fetchModels();
        } catch { /* ignore */ }
    };

    const providerOptions = Object.keys(presets).length > 0
        ? Object.keys(presets)
        : ['openai', 'anthropic', 'ollama', 'lmstudio', 'custom'];

    return (
        <div className="p-3 space-y-2">
            {/* Add button */}
            <button
                onClick={() => { setShowForm(!showForm); if (!showForm) { resetForm(); applyPreset('openai'); } }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors text-sm font-medium"
            >
                {showForm ? <X size={14} /> : <Plus size={14} />}
                {showForm ? 'Cancel' : 'Add Model'}
            </button>

            {/* Add form */}
            {showForm && (
                <form onSubmit={handleAdd} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2.5">
                    {error && (
                        <div className="text-xs text-[var(--red)] bg-[var(--red)]/10 px-2 py-1 rounded">{error}</div>
                    )}
                    <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., gpt4, claude, local-llama"
                            className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Provider</label>
                        <div className="relative">
                            <select
                                value={provider}
                                onChange={(e) => applyPreset(e.target.value)}
                                className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text)] focus:outline-none focus:border-[var(--accent)]/50 appearance-none"
                            >
                                {providerOptions.map((p) => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Model ID</label>
                        <input
                            type="text"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            placeholder="e.g., gpt-4o"
                            className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Base URL</label>
                        <input
                            type="url"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder="https://api.openai.com/v1"
                            className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">
                            API Key {presets[provider] && !presets[provider].needsKey && <span className="text-[var(--text-muted)]">(optional)</span>}
                        </label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="sk-..."
                            className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Max Tokens</label>
                        <input
                            type="number"
                            value={maxTokens}
                            onChange={(e) => setMaxTokens(parseInt(e.target.value) || 16384)}
                            min={1024}
                            className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text)] focus:outline-none focus:border-[var(--accent)]/50"
                        />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isDefault}
                            onChange={(e) => setIsDefault(e.target.checked)}
                            className="accent-[var(--accent)]"
                        />
                        Set as default model
                    </label>
                    <button
                        type="submit"
                        className="w-full py-1.5 rounded-md bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent)]/80 transition-colors"
                    >
                        Add Model
                    </button>
                </form>
            )}

            {/* Model list */}
            {models.length === 0 && !showForm ? (
                <div className="px-4 py-8 text-center text-[var(--text-muted)] text-sm">
                    No models configured
                </div>
            ) : (
                models.map((m) => (
                    <div
                        key={m.name}
                        className="px-3 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] group"
                    >
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-[var(--text)]">{m.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)]">
                                    {m.provider}
                                </span>
                                {m.isDefault && (
                                    <Star size={10} className="text-[var(--green)] fill-[var(--green)]" />
                                )}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {!m.isDefault && (
                                    <button
                                        onClick={() => handleSetDefault(m.name)}
                                        className="p-1 text-[var(--text-muted)] hover:text-[var(--green)] transition-colors"
                                        title="Set as default"
                                    >
                                        <Star size={12} />
                                    </button>
                                )}
                                <button
                                    onClick={() => setConfirmDelete(m.name)}
                                    className="p-1 text-[var(--text-muted)] hover:text-[var(--red)] transition-colors"
                                    title="Delete model"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                            <span>{m.model}</span>
                            <span className="mx-1.5">·</span>
                            <span className="truncate">{m.baseUrl}</span>
                        </div>
                        {m.apiKeyMasked && (
                            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Key: {m.apiKeyMasked}</div>
                        )}

                        {/* Delete confirmation */}
                        {confirmDelete === m.name && (
                            <div className="mt-2 flex items-center gap-2 text-xs">
                                <span className="text-[var(--red)]">Delete?</span>
                                <button
                                    onClick={() => handleDelete(m.name)}
                                    className="px-2 py-0.5 rounded bg-[var(--red)]/15 text-[var(--red)] hover:bg-[var(--red)]/25 transition-colors"
                                >
                                    Yes
                                </button>
                                <button
                                    onClick={() => setConfirmDelete(null)}
                                    className="px-2 py-0.5 rounded bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                                >
                                    No
                                </button>
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>
    );
};
