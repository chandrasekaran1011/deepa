import { describe, it, expect } from 'vitest';
import { requiresConfirmation, describeAutonomy } from '../../src/agent/autonomy.js';

describe('Autonomy System', () => {
    describe('requiresConfirmation', () => {
        it('suggest mode requires confirmation for everything', () => {
            expect(requiresConfirmation('suggest', 'safe')).toBe(true);
            expect(requiresConfirmation('suggest', 'cautious')).toBe(true);
            expect(requiresConfirmation('suggest', 'dangerous')).toBe(true);
        });

        it('ask mode auto-runs safe, asks for others', () => {
            expect(requiresConfirmation('ask', 'safe')).toBe(false);
            expect(requiresConfirmation('ask', 'cautious')).toBe(true);
            expect(requiresConfirmation('ask', 'dangerous')).toBe(true);
        });

        it('auto mode only asks for dangerous', () => {
            expect(requiresConfirmation('auto', 'safe')).toBe(false);
            expect(requiresConfirmation('auto', 'cautious')).toBe(false);
            expect(requiresConfirmation('auto', 'dangerous')).toBe(true);
        });
    });

    describe('describeAutonomy', () => {
        it('returns human-readable descriptions', () => {
            expect(describeAutonomy('suggest')).toContain('approval');
            expect(describeAutonomy('ask')).toContain('safe');
            expect(describeAutonomy('auto')).toContain('autonomy');
        });
    });
});
