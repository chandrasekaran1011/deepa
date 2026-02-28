import React, { useState } from 'react';
import { X, Box, Server, Puzzle } from 'lucide-react';
import { ModelsTab } from './settings/ModelsTab';
import { McpServersTab } from './settings/McpServersTab';
import { SkillsTab } from './settings/SkillsTab';

type Tab = 'models' | 'mcp' | 'skills';

interface SettingsPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'models', label: 'Models', icon: <Box size={13} /> },
    { id: 'mcp', label: 'MCP', icon: <Server size={13} /> },
    { id: 'skills', label: 'Skills', icon: <Puzzle size={13} /> },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<Tab>('models');

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />

            {/* Panel */}
            <div className="fixed top-0 right-0 bottom-0 z-40 w-[420px] max-w-[90vw] bg-[var(--bg-card)] border-l border-[var(--border)] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                    <span className="font-bold text-sm text-[var(--text)]">Settings</span>
                    <button
                        onClick={onClose}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Tab bar */}
                <div className="flex border-b border-[var(--border)]">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
                                activeTab === tab.id
                                    ? 'text-[var(--accent)] border-b-2 border-[var(--accent)] -mb-px'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                            }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto">
                    {activeTab === 'models' && <ModelsTab isOpen={isOpen} />}
                    {activeTab === 'mcp' && <McpServersTab isOpen={isOpen} />}
                    {activeTab === 'skills' && <SkillsTab isOpen={isOpen} />}
                </div>
            </div>
        </>
    );
};
