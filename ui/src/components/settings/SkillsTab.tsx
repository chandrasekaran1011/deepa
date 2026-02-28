import React, { useState, useEffect } from 'react';
import { Puzzle } from 'lucide-react';

interface SkillInfo {
    name: string;
    description: string;
}

interface SkillsTabProps {
    isOpen: boolean;
}

export const SkillsTab: React.FC<SkillsTabProps> = ({ isOpen }) => {
    const [skills, setSkills] = useState<SkillInfo[]>([]);

    useEffect(() => {
        if (isOpen) fetchSkills();
    }, [isOpen]);

    const fetchSkills = async () => {
        try {
            const res = await fetch('/api/skills');
            if (res.ok) {
                const data = await res.json();
                setSkills(data.skills || []);
            }
        } catch {
            // ignore
        }
    };

    if (skills.length === 0) {
        return (
            <div className="px-4 py-8 text-center text-[var(--text-muted)] text-sm">
                <Puzzle size={24} className="mx-auto mb-2 opacity-40" />
                <p>No skills installed</p>
                <p className="text-xs mt-1">Place SKILL.md directories in ~/.deepa/skills/</p>
            </div>
        );
    }

    return (
        <div className="p-3 space-y-2">
            {skills.map((s) => (
                <div
                    key={s.name}
                    className="px-3 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border)]"
                >
                    <div className="flex items-center gap-2 mb-1">
                        <Puzzle size={12} className="text-[var(--accent)] shrink-0" />
                        <span className="font-medium text-sm text-[var(--text)]">{s.name}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">{s.description}</p>
                </div>
            ))}
        </div>
    );
};
