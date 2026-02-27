// ─── Autonomy level management ───

import type { AutonomyLevel, SafetyLevel } from '../types.js';

/**
 * Determine whether a tool action requires user confirmation
 * based on the current autonomy level and tool safety level.
 */
export function requiresConfirmation(
    autonomy: AutonomyLevel,
    safety: SafetyLevel,
): boolean {
    switch (autonomy) {
        case 'low':
            // low autonomy requires approval for absolutely everything
            return true;

        case 'medium':
            // medium autonomy auto-approves low/medium risk. Approves high/very-high risk.
            if (safety === 'low' || safety === 'medium') return false;
            return true;

        case 'high':
            // high autonomy auto-approves low/medium/high risk. Only asks for very-high risk.
            if (safety === 'very-high') return true;
            return false;

        default:
            return true;
    }
}

/**
 * Get a human-readable description of the current autonomy level.
 */
export function describeAutonomy(level: AutonomyLevel): string {
    switch (level) {
        case 'low':
            return 'Low — all actions require approval';
        case 'medium':
            return 'Medium — standard operations are automatic, high risk actions need approval';
        case 'high':
            return 'High — full autonomy, only very-high risk actions need approval';
    }
}
