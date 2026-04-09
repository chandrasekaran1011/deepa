// ─── Hooks system ───
// Loads hook definitions from ~/.deepa/settings.json and .deepa/settings.json
// Hook execution follows Claude Code semantics:
//   exit 0  → pass stdout as context to the model (if non-empty)
//   exit 2  → block the action + send stderr as error message to the model
//   other   → ignore (non-fatal)

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';

// ─── Types ───

export type HookEvent =
    | 'PreToolUse'
    | 'PostToolUse'
    | 'SessionStart'
    | 'SessionEnd';

export interface HookDefinition {
    /** Shell command to run */
    command: string;
    /** Working directory (defaults to project cwd) */
    cwd?: string;
    /** Timeout in ms (default: 5000) */
    timeout?: number;
}

export interface HooksConfig {
    PreToolUse?: HookDefinition[];
    PostToolUse?: HookDefinition[];
    SessionStart?: HookDefinition[];
    SessionEnd?: HookDefinition[];
}

export interface HookResult {
    /** Should the tool call be blocked? */
    block: boolean;
    /** Message to inject into the model context (from stdout on exit 0) */
    contextMessage?: string;
    /** Error message shown when blocked (from stderr on exit 2) */
    errorMessage?: string;
}

// ─── Settings loading ───

function loadSettingsFile(filePath: string): HooksConfig {
    if (!existsSync(filePath)) return {};
    try {
        const raw = readFileSync(filePath, 'utf-8');
        const json = JSON.parse(raw);
        return (json.hooks as HooksConfig) || {};
    } catch {
        return {};
    }
}

function mergeHooksConfig(base: HooksConfig, override: HooksConfig): HooksConfig {
    const result: HooksConfig = { ...base };
    for (const key of Object.keys(override) as HookEvent[]) {
        const overrideHooks = override[key] || [];
        const baseHooks = result[key] || [];
        result[key] = [...baseHooks, ...overrideHooks];
    }
    return result;
}

export function loadHooksConfig(projectCwd: string): HooksConfig {
    // Global settings: ~/.deepa/settings.json
    const globalPath = join(homedir(), '.deepa', 'settings.json');
    // Project settings: {cwd}/.deepa/settings.json
    const projectPath = join(projectCwd, '.deepa', 'settings.json');

    const global = loadSettingsFile(globalPath);
    const project = loadSettingsFile(projectPath);

    return mergeHooksConfig(global, project);
}

// ─── Hook execution ───

export interface HookEnvironment {
    tool_name?: string;
    tool_input?: string;   // JSON string of tool params
    tool_result?: string;  // JSON string of tool result
    session_id?: string;
    cwd?: string;
}

/**
 * Run a single hook definition. Returns its result.
 */
function runHook(hook: HookDefinition, env: HookEnvironment, projectCwd: string): HookResult {
    const isWin = process.platform === 'win32';
    const shell = isWin ? (process.env.ComSpec || 'cmd.exe') : 'sh';
    const shellArgs = isWin ? ['/c', hook.command] : ['-c', hook.command];

    const envVars: Record<string, string> = {
        ...process.env as Record<string, string>,
    };
    if (env.tool_name) envVars['DEEPA_TOOL_NAME'] = env.tool_name;
    if (env.tool_input) envVars['DEEPA_TOOL_INPUT'] = env.tool_input;
    if (env.tool_result) envVars['DEEPA_TOOL_RESULT'] = env.tool_result;
    if (env.session_id) envVars['DEEPA_SESSION_ID'] = env.session_id;
    if (env.cwd) envVars['DEEPA_CWD'] = env.cwd;

    try {
        const result = spawnSync(shell, shellArgs, {
            cwd: hook.cwd || projectCwd,
            env: envVars,
            timeout: hook.timeout ?? 5000,
            encoding: 'utf-8',
        });

        const exitCode = result.status ?? -1;
        const stdout = (result.stdout || '').trim();
        const stderr = (result.stderr || '').trim();

        if (exitCode === 2) {
            // Block + show stderr to model
            return {
                block: true,
                errorMessage: stderr || `Hook blocked tool: ${hook.command}`,
            };
        }

        if (exitCode === 0 && stdout) {
            // Pass stdout as context to model
            return { block: false, contextMessage: stdout };
        }

        return { block: false };
    } catch {
        // Hook execution error — non-fatal, don't block
        return { block: false };
    }
}

/**
 * Run all hooks for a given event. Returns combined result.
 * If any hook blocks, subsequent hooks are not run.
 */
export function runHooks(
    event: HookEvent,
    config: HooksConfig,
    env: HookEnvironment,
    projectCwd: string,
): HookResult {
    const hooks = config[event] || [];
    const contextParts: string[] = [];

    for (const hook of hooks) {
        const result = runHook(hook, env, projectCwd);
        if (result.block) {
            return result; // First blocking hook wins
        }
        if (result.contextMessage) {
            contextParts.push(result.contextMessage);
        }
    }

    return {
        block: false,
        contextMessage: contextParts.length > 0 ? contextParts.join('\n') : undefined,
    };
}
