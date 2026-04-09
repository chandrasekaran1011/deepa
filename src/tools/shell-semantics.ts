// ─── Shell semantics and anti-blocking heuristics ───

export type CommandSemantic = (
    exitCode: number,
    stdout: string,
    stderr: string,
) => {
    isError: boolean;
    message?: string;
};

const DEFAULT_SEMANTIC: CommandSemantic = (exitCode) => ({
    isError: exitCode !== 0,
    message: exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
});

const COMMAND_SEMANTICS = new Map<string, CommandSemantic>([
    [
        'grep',
        (exitCode) => ({
            isError: exitCode >= 2,
            message: exitCode === 1 ? 'Exit code 1: No matches found' : undefined,
        }),
    ],
    [
        'rg',
        (exitCode) => ({
            isError: exitCode >= 2,
            message: exitCode === 1 ? 'Exit code 1: No matches found' : undefined,
        }),
    ],
    [
        'find',
        (exitCode) => ({
            isError: exitCode >= 2,
            message: exitCode === 1 ? 'Exit code 1: Partial success (some dirs inaccessible)' : undefined,
        }),
    ],
    [
        'diff',
        (exitCode) => ({
            isError: exitCode >= 2,
            message: exitCode === 1 ? 'Exit code 1: Files differ' : undefined,
        }),
    ],
    [
        'test',
        (exitCode) => ({
            isError: exitCode >= 2,
            message: exitCode === 1 ? 'Exit code 1: Condition is false' : undefined,
        }),
    ],
    [
        '[',
        (exitCode) => ({
            isError: exitCode >= 2,
            message: exitCode === 1 ? 'Exit code 1: Condition is false' : undefined,
        }),
    ],
]);

export function extractBaseCommand(command: string): string {
    // The exit code of a pipeline is determined by the last command
    const segments = command.split('|');
    const lastCommand = segments[segments.length - 1].trim();
    return lastCommand.split(/\s+/)[0] || '';
}

export function interpretCommandResult(
    command: string,
    exitCode: number,
    stdout: string,
    stderr: string,
): { isError: boolean; message?: string } {
    const baseCommand = extractBaseCommand(command);
    const semantic = COMMAND_SEMANTICS.get(baseCommand) || DEFAULT_SEMANTIC;
    return semantic(exitCode, stdout, stderr);
}

// ─── Dangerous pattern detection ───

interface DangerousPattern {
    pattern: RegExp;
    message: string;
    riskLevel: 'warn' | 'block';
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
    // Recursive deletion of system root or home
    { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(\/|~\/?\s*$|\$HOME\/?\s*$)/, message: 'Recursive deletion of root or home directory', riskLevel: 'block' },
    { pattern: /\brm\s+-rf\s+\//, message: 'Recursive deletion starting at root', riskLevel: 'block' },
    // Curl/wget piped to shell — remote code execution
    { pattern: /\b(curl|wget)\b[^|]*\|\s*(bash|sh|zsh|fish|python3?|node|ruby|perl)\b/, message: 'Downloading and executing remote code via pipe', riskLevel: 'block' },
    // Fork bomb
    { pattern: /:\(\s*\)\s*\{.*:\|:.*\}/, message: 'Fork bomb pattern detected', riskLevel: 'block' },
    // chmod 777 on root or system dirs
    { pattern: /\bchmod\s+(-R\s+)?777\s+(\/|\/etc|\/usr|\/bin|\/sbin|\/lib)/, message: 'chmod 777 on system directory', riskLevel: 'block' },
    // dd writing to raw disk devices
    { pattern: /\bdd\b.*\bof=\/dev\/(sd[a-z]|hd[a-z]|nvme|disk)\b(?!p)/, message: 'Writing directly to raw disk device', riskLevel: 'block' },
    // Format/wipe disk
    { pattern: /\b(mkfs|shred|wipefs)\b.*\/dev\/(sd[a-z]|hd[a-z]|nvme|disk)\b/, message: 'Disk format or wipe operation', riskLevel: 'block' },
    // Python/node one-liners that exec/eval remote content
    { pattern: /\b(python3?|node)\b.*\bexec\s*\(\s*__import__\s*\(/, message: 'Executing dynamically imported remote code', riskLevel: 'block' },
    // sudo with password on stdin
    { pattern: /echo\s+['"][^'"]*['"]\s*\|\s*sudo\s+-S/, message: 'Passing password to sudo via stdin', riskLevel: 'warn' },
    // Truncating important system files
    { pattern: />\s*(\/etc\/passwd|\/etc\/shadow|\/etc\/hosts|\/etc\/sudoers)/, message: 'Truncating a critical system file', riskLevel: 'block' },
];

export interface DangerCheckResult {
    isDangerous: boolean;
    riskLevel?: 'warn' | 'block';
    message?: string;
}

/**
 * Check a shell command for dangerous patterns.
 * Returns { isDangerous: false } if safe, or { isDangerous: true, riskLevel, message } if dangerous.
 */
export function checkDangerousCommand(command: string): DangerCheckResult {
    for (const dp of DANGEROUS_PATTERNS) {
        if (dp.pattern.test(command)) {
            return { isDangerous: true, riskLevel: dp.riskLevel, message: dp.message };
        }
    }
    return { isDangerous: false };
}

/**
 * Detect standalone sleep patterns that cause loops to stall unnecessarily.
 */
export function detectBlockedSleepPattern(command: string): string | null {
    const segments = command.split('&&').map(s => s.trim().split('||').map(v => v.trim())).flat();
    const first = segments[0] ?? '';
    const m = /^sleep\s+(\d+)(?:\.\d+)?\s*$/.exec(first);
    if (!m) return null;
    const secs = parseInt(m[1]!, 10);
    if (secs < 2) return null; // pacing/rate limits (<2s) are okay
    return `sleep ${secs}`;
}
