// ─── Autonomy level management ───

import type { AutonomyLevel } from '../types.js';

export type SafetyLevel = 'safe' | 'cautious' | 'dangerous';

/**
 * Determine whether a tool action requires user confirmation
 * based on the current autonomy level and tool safety level.
 */
export function requiresConfirmation(
    autonomy: AutonomyLevel,
    safety: SafetyLevel,
): boolean {
    switch (autonomy) {
        case 'suggest':
            // ALL actions require confirmation
            return true;

        case 'ask':
            // Safe actions auto-run, cautious and dangerous require confirmation
            return safety !== 'safe';

        case 'auto':
            // Only dangerous actions require confirmation  
            return safety === 'dangerous';

        default:
            return true;
    }
}

/**
 * Get a human-readable description of the current autonomy level.
 */
export function describeAutonomy(level: AutonomyLevel): string {
    switch (level) {
        case 'suggest':
            return 'Suggest — every action requires your approval';
        case 'ask':
            return 'Ask — safe reads are automatic, writes/commands need approval';
        case 'auto':
            return 'Auto — full autonomy, only critical actions need approval';
    }
}
