import React, { useEffect, useRef } from 'react';

export interface SlashCommand {
    command: string;        // e.g. "/clear"
    description: string;   // one-line description
    usage?: string;        // e.g. "/mcp add <name> <cmd>"
    group?: string;        // for visual grouping
}

export const SLASH_COMMANDS: SlashCommand[] = [
    // Session
    { group: 'Session', command: '/clear',    description: 'Clear conversation history' },
    { group: 'Session', command: '/compact',  description: 'Force deep history compaction' },
    { group: 'Session', command: '/session',  description: 'Show active session details' },
    { group: 'Session', command: '/memory',   description: 'Show current memory index' },
    // Mode
    { group: 'Mode',    command: '/chat',     description: 'Switch to conversational mode (default)' },
    { group: 'Mode',    command: '/plan',     description: 'Switch to read-only planning mode' },
    { group: 'Mode',    command: '/exec',     description: 'Switch to autonomous execution mode' },
    { group: 'Mode',    command: '/autonomy', description: 'Set autonomy level', usage: '/autonomy <low|medium|high>' },
    // Info
    { group: 'Info',    command: '/skills',   description: 'List available skills' },
    { group: 'Info',    command: '/agents',   description: 'List available subagents' },
    { group: 'Info',    command: '/help',     description: 'Show all available commands' },
    // Model
    { group: 'Model',   command: '/model',    description: 'List or switch models', usage: '/model list | /model use <name>' },
    // MCP
    { group: 'MCP',     command: '/mcp list',    description: 'List connected MCP servers and tools' },
    { group: 'MCP',     command: '/mcp add',     description: 'Add an MCP server', usage: '/mcp add <name> <cmd> [args]' },
    { group: 'MCP',     command: '/mcp remove',  description: 'Remove an MCP server', usage: '/mcp remove <name>' },
    { group: 'MCP',     command: '/mcp enable',  description: 'Enable a disabled MCP server', usage: '/mcp enable <name>' },
    { group: 'MCP',     command: '/mcp disable', description: 'Disable an MCP server', usage: '/mcp disable <name>' },
    // Media
    { group: 'Media',   command: '/image',    description: 'Attach an image from a path', usage: '/image <path> [message]' },
    { group: 'Media',   command: '/paste',    description: 'Paste image from clipboard', usage: '/paste [message]' },
];

interface SlashCommandPickerProps {
    query: string;           // text after the leading "/"
    selectedIndex: number;
    onSelect: (command: SlashCommand) => void;
    onClose: () => void;
}

export const SlashCommandPicker: React.FC<SlashCommandPickerProps> = ({
    query,
    selectedIndex,
    onSelect,
    onClose,
}) => {
    const listRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    // Filter by query
    const filtered = SLASH_COMMANDS.filter(cmd => {
        if (!query) return true;
        const q = query.toLowerCase();
        return (
            cmd.command.toLowerCase().includes(q) ||
            cmd.description.toLowerCase().includes(q) ||
            (cmd.group?.toLowerCase().includes(q) ?? false)
        );
    });

    // Scroll selected item into view
    useEffect(() => {
        itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    if (filtered.length === 0) return null;

    // Group headers
    let lastGroup = '';

    return (
        <div
            ref={listRef}
            className="absolute bottom-full mb-2 left-0 right-0 max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xl z-50"
        >
            <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                    Slash Commands
                </span>
                <button
                    onClick={onClose}
                    className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs px-1"
                >
                    esc
                </button>
            </div>
            <div className="pb-1.5">
                {filtered.map((cmd, idx) => {
                    const showGroupHeader = cmd.group && cmd.group !== lastGroup;
                    lastGroup = cmd.group ?? '';
                    const isSelected = idx === selectedIndex;

                    return (
                        <React.Fragment key={cmd.command}>
                            {showGroupHeader && (
                                <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]/60">
                                    {cmd.group}
                                </div>
                            )}
                            <button
                                ref={(el) => { itemRefs.current[idx] = el; }}
                                onClick={() => onSelect(cmd)}
                                className={`w-full text-left px-3 py-1.5 flex items-baseline gap-3 transition-colors ${
                                    isSelected
                                        ? 'bg-[var(--accent)]/15 text-[var(--text)]'
                                        : 'hover:bg-[var(--bg-input)] text-[var(--text-secondary)]'
                                }`}
                            >
                                <span className={`font-mono text-sm shrink-0 ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--accent)]/70'}`}>
                                    {cmd.command}
                                </span>
                                <span className="text-xs text-[var(--text-muted)] truncate">
                                    {cmd.usage
                                        ? <><span className="text-[var(--text-secondary)]">{cmd.usage}</span> — {cmd.description}</>
                                        : cmd.description
                                    }
                                </span>
                            </button>
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
};

/**
 * Returns filtered commands and the current slash query from the textarea value.
 * Returns null if the user is not in slash-command mode.
 */
export function getSlashQuery(value: string): string | null {
    // Only activate when the *entire* current line starts with "/"
    // (handles multi-line input — only the active line matters)
    const lines = value.split('\n');
    const lastLine = lines[lines.length - 1];
    if (lastLine.startsWith('/')) {
        return lastLine.slice(1); // return everything after "/"
    }
    return null;
}
