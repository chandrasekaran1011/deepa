import { describe, it, expect } from 'vitest';
import { requiresConfirmation, describeAutonomy } from '../../src/agent/autonomy.js';

describe('Autonomy System', () => {
    describe('requiresConfirmation', () => {
        it('suggest mode requires confirmation for everything', () => {
            expect(requiresConfirmation('low', 'low')).toBe(true);
            expect(requiresConfirmation('low', 'medium')).toBe(true);
            expect(requiresConfirmation('low', 'very-high')).toBe(true);
        });

        it('medium autonomy auto-approves low/medium risk, asks for high+', () => {
            expect(requiresConfirmation('medium', 'low')).toBe(false);
            expect(requiresConfirmation('medium', 'medium')).toBe(false);
            expect(requiresConfirmation('medium', 'high')).toBe(true);
            expect(requiresConfirmation('medium', 'very-high')).toBe(true);
        });

        it('auto mode only asks for dangerous', () => {
            expect(requiresConfirmation('high', 'low')).toBe(false);
            expect(requiresConfirmation('high', 'medium')).toBe(false);
            expect(requiresConfirmation('high', 'very-high')).toBe(true);
        });
    });

    describe('describeAutonomy', () => {
        it('returns human-readable descriptions', () => {
            expect(describeAutonomy('low')).toContain('approval');
            expect(describeAutonomy('medium')).toContain('automatic');
            expect(describeAutonomy('high')).toContain('autonomy');
        });
    });
});
