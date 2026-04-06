// ─── Shell execution tool ───
// Detects inline scripts (node -e, python -c, etc.) and auto-converts them
// to temp files for safer, more reliable execution.

import { spawn, execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolvePath } from './resolve-path.js';
import { interpretCommandResult, detectBlockedSleepPattern, checkDangerousCommand } from './shell-semantics.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    command: z.string().describe('Shell command to execute'),
    cwd: z.string().nullish().describe('Working directory (optional)'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds (default: 30s)'),
    background: z.boolean().optional().default(false).describe('Run command in background (e.g. for servers)'),
});

// Registry for background processes to ensure they are killed on exit
const activeBackgroundProcesses: number[] = [];

export function killBackgroundProcesses(): void {
    for (const pid of activeBackgroundProcesses) {
        try {
            if (process.platform === 'win32') {
                // Windows: use taskkill to kill entire process tree
                execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
            } else {
                // Unix: negative PID kills the process group
                process.kill(-pid);
            }
        } catch {
            try {
                if (process.platform === 'win32') {
                    // Windows fallback: kill single process
                    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
                } else {
                    process.kill(pid);
                }
            } catch {
                // Ignore if process is already dead
            }
        }
    }
}

// ─── Inline script detection and extraction ───

interface InlineScript {
    runtime: string;      // 'node' | 'python3' | 'python' | 'ruby' | 'perl'
    extension: string;    // '.mjs' | '.py' | '.rb' | '.pl'
    code: string;         // extracted script body
}

/** Runtime → file extension mapping */
const RUNTIME_EXT: Record<string, string> = {
    node: '.mjs',
    python3: '.py',
    python: '.py',
    ruby: '.rb',
    perl: '.pl',
};

/** Normalize runtime name (python → python3) */
function normalizeRuntime(rt: string): string {
    return rt === 'python' ? 'python3' : rt;
}

/** Pattern 1: -e / -c / --eval flag with quoted string */
const FLAG_PATTERNS: Array<{
    regex: RegExp;
    runtimeGroup: number;
    codeGroup: number;
}> = [
        // node -e '...' / node -e "..." / node --eval '...'
        { regex: /^(node)\s+(?:-e|--eval)\s+(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/, runtimeGroup: 1, codeGroup: 2 },
        // python3 -c '...' / python -c '...'
        { regex: /^(python3?)\s+-c\s+(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/, runtimeGroup: 1, codeGroup: 2 },
        // ruby -e '...'
        { regex: /^(ruby)\s+-e\s+(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/, runtimeGroup: 1, codeGroup: 2 },
        // perl -e '...'
        { regex: /^(perl)\s+-e\s+(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/, runtimeGroup: 1, codeGroup: 2 },
    ];

/** Pattern 2: heredoc — `python3 - <<'DELIM'\n...\nDELIM` or `python3 <<'DELIM'\n...\nDELIM` */
const HEREDOC_REGEX = /^(node|python3?|ruby|perl)\s+(?:-\s+)?<<-?\s*'?(\w+)'?\s*\n([\s\S]*?)\n\2\s*$/;

/** Pattern 3: echo piped — `echo '...' | python3` or `echo "..." | node` */
const ECHO_PIPE_REGEX = /^echo\s+(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*\|\s*(node|python3?|ruby|perl)\b/;

function detectInlineScript(command: string): InlineScript | null {
    const trimmed = command.trim();

    // Check flag patterns (-e, -c, --eval)
    for (const pattern of FLAG_PATTERNS) {
        const match = trimmed.match(pattern.regex);
        if (match) {
            const runtime = normalizeRuntime(match[pattern.runtimeGroup]);
            const code = match[pattern.codeGroup] || match[pattern.codeGroup + 1];
            if (code && code.length > 0) {
                return { runtime, extension: RUNTIME_EXT[runtime] || '.txt', code };
            }
        }
    }

    // Check heredoc patterns (python3 - <<'PY'\n...\nPY)
    const heredocMatch = trimmed.match(HEREDOC_REGEX);
    if (heredocMatch) {
        const runtime = normalizeRuntime(heredocMatch[1]);
        const code = heredocMatch[3];
        if (code && code.length > 0) {
            return { runtime, extension: RUNTIME_EXT[runtime] || '.txt', code };
        }
    }

    // Check echo pipe patterns (echo '...' | python3)
    const echoMatch = trimmed.match(ECHO_PIPE_REGEX);
    if (echoMatch) {
        const code = echoMatch[1] || echoMatch[2];
        const runtime = normalizeRuntime(echoMatch[3]);
        if (code && code.length > 0) {
            return { runtime, extension: RUNTIME_EXT[runtime] || '.txt', code };
        }
    }

    return null;
}

function runCommand(command: string, workDir: string, timeout: number, background = false): Promise<ToolResult> {
    return new Promise<ToolResult>((resolvePromise) => {
        const isWin = process.platform === 'win32';
        const shell = isWin ? (process.env.ComSpec || 'cmd.exe') : 'sh';
        const shellArgs = isWin ? ['/c', command] : ['-c', command];
        const child = spawn(shell, shellArgs, {
            cwd: workDir,
            env: { ...process.env, PAGER: 'cat' },
            timeout: background ? undefined : timeout,
            detached: background && !isWin,
            stdio: background ? 'ignore' : 'pipe',
        });

        if (background) {
            child.unref();
            if (child.pid) activeBackgroundProcesses.push(child.pid);
            return resolvePromise({
                content: `Started background process with PID ${child.pid}`,
                isError: false,
            });
        }

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('error', (err) => {
            resolvePromise({
                content: `Command failed to start: ${err.message}`,
                isError: true,
            });
        });

        child.on('close', (code) => {
            const output: string[] = [];
            if (stdout.trim()) output.push(`stdout:\n${stdout.trim()}`);
            if (stderr.trim()) output.push(`stderr:\n${stderr.trim()}`);
            
            const semanticResult = (code !== null) ? interpretCommandResult(command, code, stdout, stderr) : {isError: true};

            if (semanticResult.message) {
                 output.push(`\n${semanticResult.message}`);
            } else if (code !== null) {
                 output.push(`\nExit code: ${code}`);
            }

            let content = output.join('\n\n');

            // Check for git lock hallucination loops
            if (content.includes(".git/index.lock': File exists")) {
                 content += '\n\n[Hint: A stray git lock was detected. You can usually fix this by running: rm -f .git/index.lock]';
            }

            // Truncation safeguard + salvage
            const MAX_OUTPUT = 8000;
            if (content.length > MAX_OUTPUT) {
                 try {
                     const tmpLogDir = join(tmpdir(), '.deepa', 'tmp');
                     if (!existsSync(tmpLogDir)) mkdirSync(tmpLogDir, { recursive: true });
                     const tmpFile = join(tmpLogDir, `shell_output_${Date.now()}.log`);
                     const fullLength = content.length;
                     writeFileSync(tmpFile, content, 'utf-8');

                     // Slice top and bottom to give context, avoiding overlap
                     const halfMax = Math.floor(MAX_OUTPUT / 2);
                     const head = content.slice(0, halfMax);
                     const tail = fullLength > MAX_OUTPUT ? content.slice(-halfMax) : '';
                     content = `${head}\n\n... [Output truncated. Full command log (${Math.round(fullLength / 1024)}KB) saved to: ${tmpFile}. Use file_read to inspect the full trace if needed.] ...\n\n${tail}`;
                 } catch (e) {
                     // fallback to normal truncation
                     content = content.slice(0, MAX_OUTPUT) + '\n\n... [Output truncated]';
                 }
            }

            resolvePromise({
                content,
                isError: semanticResult.isError,
            });
        });
    });
}

export const shellTool: Tool = {
    name: 'shell',
    description:
        'Execute a shell command. Use for running tests, builds, git operations, installing packages, or running script files. ' +
        'Inline scripts (node -e, python -c, heredocs, echo pipes) are automatically converted to temp files for reliable execution. ' +
        'Prefer writing code to a file with file_write first, then running it.',
    parameters,
    riskLevel: 'high',

    // Skip the generic 8000 char blocker since Shell brings its own smart local truncation logic
    maxOutputChars: 20000,

    async validateInput(params: unknown, context: ToolContext) {
        const { command, background } = params as z.infer<typeof parameters>;

        // Dangerous pattern detection
        const danger = checkDangerousCommand(command);
        if (danger.isDangerous) {
            if (danger.riskLevel === 'block') {
                return { valid: false, message: `Blocked dangerous command — ${danger.message}. Command: ${command}` };
            }
            // 'warn' level — require explicit confirmation regardless of autonomy
            const confirmed = await context.confirmAction(
                `⚠️ Potentially dangerous command detected — ${danger.message}\n\nCommand: ${command}\n\nProceed?`,
            );
            if (!confirmed) {
                return { valid: false, message: `Command rejected by user — ${danger.message}` };
            }
        }

        if (!background) {
             const sleepCmd = detectBlockedSleepPattern(command);
             if (sleepCmd) {
                 return { valid: false, message: `Blocked: ${sleepCmd}. Do not block the session loop with sleep. Use background: true to run long commands instead. If you genuinely need a delay for pacing, keep it under 2 seconds.` };
             }
        }
        return { valid: true };
    },

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { command, cwd, timeout, background } = params as z.infer<typeof parameters>;
        const workDir = resolvePath(cwd || '.', context.cwd);

        // Detect inline scripts and auto-convert to temp files
        const inline = detectInlineScript(command);
        if (inline) {
            const tmpDir = join(tmpdir(), '.deepa', 'tmp');
            if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

            const tmpFile = join(tmpDir, `_inline_${Date.now()}${inline.extension}`);
            context.log(`[shell] inline ${inline.runtime} script detected → writing to ${tmpFile}`);

            try {
                writeFileSync(tmpFile, inline.code, 'utf-8');
                const result = await runCommand(`${inline.runtime} ${tmpFile}`, workDir, timeout, background);

                // Prepend a note so the LLM knows it was auto-converted
                result.content = `[auto-converted inline script to ${tmpFile}]\n\n${result.content}`;
                return result;
            } finally {
                // Always clean up the temp file
                try { unlinkSync(tmpFile); } catch { /* ignore */ }
            }
        }

        context.log(`$ ${command}${background ? ' [background]' : ''}`);
        return runCommand(command, workDir, timeout, background);
    },
};
