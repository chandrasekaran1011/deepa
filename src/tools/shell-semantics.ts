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
