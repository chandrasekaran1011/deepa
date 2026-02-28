import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Terminal, Globe, X, AlertCircle } from 'lucide-react';

interface McpServer {
    name: string;
    command?: string;
    args?: string[];
    url?: string;
    transport?: string;
}

interface McpServersTabProps {
    isOpen: boolean;
}

export const McpServersTab: React.FC<McpServersTabProps> = ({ isOpen }) => {
    const [servers, setServers] = useState<McpServer[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [serverName, setServerName] = useState('');
    const [serverType, setServerType] = useState<'stdio' | 'remote'>('stdio');
    const [command, setCommand] = useState('');
    const [args, setArgs] = useState('');
    const [url, setUrl] = useState('');
    const [transport, setTransport] = useState<'http' | 'sse'>('http');

    useEffect(() => {
        if (isOpen) fetchServers();
    }, [isOpen]);

    const fetchServers = async () => {
        try {
            const res = await fetch('/api/mcp');
            if (res.ok) {
                const data = await res.json();
                // Convert object map to array
                const serverMap = data.servers || {};
                const list: McpServer[] = Object.entries(serverMap).map(([name, cfg]: [string, any]) => ({
                    name,
                    ...cfg,
                }));
                setServers(list);
            }
        } catch { /* ignore */ }
    };

    const resetForm = () => {
        setServerName('');
        setServerType('stdio');
        setCommand('');
        setArgs('');
        setUrl('');
        setTransport('http');
        setError(null);
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!serverName.trim()) {
            setError('Server name is required');
            return;
        }

        let body: any;
        if (serverType === 'stdio') {
            if (!command.trim()) {
                setError('Command is required');
                return;
            }
            body = {
                command: command.trim(),
                args: args.trim() ? args.split(',').map(a => a.trim()).filter(Boolean) : [],
            };
        } else {
            if (!url.trim()) {
                setError('URL is required');
                return;
            }
            body = { url: url.trim(), transport };
        }

        try {
            const res = await fetch(`/api/mcp/${encodeURIComponent(serverName.trim())}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                resetForm();
                setShowForm(false);
                await fetchServers();
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to add server');
            }
        } catch {
            setError('Failed to add server');
        }
    };

    const handleDelete = async (name: string) => {
        try {
            const res = await fetch(`/api/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' });
            if (res.ok) {
                setConfirmDelete(null);
                await fetchServers();
            }
        } catch { /* ignore */ }
    };

    return (
        <div className="p-3 space-y-2">
            {/* Info banner */}
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--accent)]/5 border border-[var(--accent)]/10 text-xs text-[var(--text-muted)]">
                <AlertCircle size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                <span>MCP server changes take effect after restarting <code className="text-[var(--accent)]">deepa ui</code></span>
            </div>

            {/* Add button */}
            <button
                onClick={() => { setShowForm(!showForm); if (!showForm) resetForm(); }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors text-sm font-medium"
            >
                {showForm ? <X size={14} /> : <Plus size={14} />}
                {showForm ? 'Cancel' : 'Add MCP Server'}
            </button>

            {/* Add form */}
            {showForm && (
                <form onSubmit={handleAdd} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2.5">
                    {error && (
                        <div className="text-xs text-[var(--red)] bg-[var(--red)]/10 px-2 py-1 rounded">{error}</div>
                    )}
                    <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Server Name</label>
                        <input
                            type="text"
                            value={serverName}
                            onChange={(e) => setServerName(e.target.value)}
                            placeholder="e.g., my-tools"
                            className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
                            required
                        />
                    </div>

                    {/* Type toggle */}
                    <div className="flex rounded-md overflow-hidden border border-[var(--border)]">
                        <button
                            type="button"
                            onClick={() => setServerType('stdio')}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs transition-colors ${
                                serverType === 'stdio'
                                    ? 'bg-[var(--accent)]/20 text-[var(--accent)] font-semibold'
                                    : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                            }`}
                        >
                            <Terminal size={12} />
                            Local (stdio)
                        </button>
                        <button
                            type="button"
                            onClick={() => setServerType('remote')}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs transition-colors ${
                                serverType === 'remote'
                                    ? 'bg-[var(--accent)]/20 text-[var(--accent)] font-semibold'
                                    : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                            }`}
                        >
                            <Globe size={12} />
                            Remote
                        </button>
                    </div>

                    {serverType === 'stdio' ? (
                        <>
                            <div>
                                <label className="block text-xs text-[var(--text-muted)] mb-1">Command</label>
                                <input
                                    type="text"
                                    value={command}
                                    onChange={(e) => setCommand(e.target.value)}
                                    placeholder="e.g., npx"
                                    className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--text-muted)] mb-1">Arguments (comma-separated)</label>
                                <input
                                    type="text"
                                    value={args}
                                    onChange={(e) => setArgs(e.target.value)}
                                    placeholder="e.g., -y, @modelcontextprotocol/server-filesystem, /tmp"
                                    className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <label className="block text-xs text-[var(--text-muted)] mb-1">URL</label>
                                <input
                                    type="url"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    placeholder="https://mcp.example.com/sse"
                                    className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--text-muted)] mb-1">Transport</label>
                                <div className="flex rounded-md overflow-hidden border border-[var(--border)]">
                                    {(['http', 'sse'] as const).map((t) => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => setTransport(t)}
                                            className={`flex-1 py-1.5 text-xs transition-colors ${
                                                transport === t
                                                    ? 'bg-[var(--accent)]/20 text-[var(--accent)] font-semibold'
                                                    : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                            }`}
                                        >
                                            {t.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    <button
                        type="submit"
                        className="w-full py-1.5 rounded-md bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent)]/80 transition-colors"
                    >
                        Add Server
                    </button>
                </form>
            )}

            {/* Server list */}
            {servers.length === 0 && !showForm ? (
                <div className="px-4 py-8 text-center text-[var(--text-muted)] text-sm">
                    No MCP servers configured
                </div>
            ) : (
                servers.map((s) => {
                    const isRemote = !!s.url;
                    return (
                        <div
                            key={s.name}
                            className="px-3 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] group"
                        >
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                    {isRemote ? (
                                        <Globe size={12} className="text-[var(--accent)] shrink-0" />
                                    ) : (
                                        <Terminal size={12} className="text-[var(--green)] shrink-0" />
                                    )}
                                    <span className="font-medium text-sm text-[var(--text)]">{s.name}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                        isRemote
                                            ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                                            : 'bg-[var(--green)]/10 text-[var(--green)]'
                                    }`}>
                                        {isRemote ? (s.transport || 'http').toUpperCase() : 'stdio'}
                                    </span>
                                </div>
                                <button
                                    onClick={() => setConfirmDelete(s.name)}
                                    className="p-1 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--red)] transition-all"
                                    title="Delete server"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                            <div className="text-xs text-[var(--text-muted)] truncate">
                                {isRemote ? s.url : `${s.command} ${(s.args || []).join(' ')}`}
                            </div>

                            {/* Delete confirmation */}
                            {confirmDelete === s.name && (
                                <div className="mt-2 flex items-center gap-2 text-xs">
                                    <span className="text-[var(--red)]">Delete?</span>
                                    <button
                                        onClick={() => handleDelete(s.name)}
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
                    );
                })
            )}
        </div>
    );
};
