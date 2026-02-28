// ─── Terminal UI: markdown rendering, spinners, prompt ───

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { createInterface, emitKeypressEvents } from 'readline';

// ─── Colour palette ───────────────────────────────────────

export const C = {
    primary: chalk.hex('#7C3AED'),      // violet  — brand colour
    accent: chalk.hex('#06B6D4'),      // cyan
    success: chalk.hex('#10B981'),      // emerald
    warn: chalk.hex('#F59E0B'),      // amber
    error: chalk.hex('#EF4444'),      // red
    muted: chalk.hex('#6B7280'),      // cool-grey
    bright: chalk.hex('#F9FAFB'),      // near-white
    tag: chalk.hex('#4ADE80'),      // green badge
};

// ─── Markdown-ish rendering ───────────────────────────────

export function renderMarkdown(text: string): string {
    return text
        .replace(/^### (.+)$/gm, chalk.bold.cyan('   $1'))
        .replace(/^## (.+)$/gm, chalk.bold.blue('  $1'))
        .replace(/^# (.+)$/gm, chalk.bold.magenta(' $1'))
        .replace(/\*\*(.+?)\*\*/g, chalk.bold('$1'))
        .replace(/(?<!\*)\*(.+?)\*(?!\*)/g, chalk.italic('$1'))
        .replace(/`([^`]+)`/g, C.accent('$1'))
        .replace(/\[x\]/g, C.success('☑'))
        .replace(/\[ \]/g, C.muted('☐'))
        .replace(/\[\/\]/g, C.warn('◐'));
}

// ─── Spinner ──────────────────────────────────────────────

let currentSpinner: Ora | null = null;

export function startSpinner(text: string): Ora {
    stopSpinner();
    currentSpinner = ora({
        text: C.muted(text),
        spinner: 'dots',
        color: 'magenta',
    }).start();
    return currentSpinner;
}

export function updateSpinner(text: string): void {
    if (currentSpinner) currentSpinner.text = C.muted(text);
}

export function stopSpinner(success?: string): void {
    if (currentSpinner) {
        if (success) {
            currentSpinner.succeed(C.success(success));
        } else {
            currentSpinner.stop();
        }
        currentSpinner = null;
    }
}

// ─── User Input ───────────────────────────────────────────

// Magic prefix returned by promptUser when Ctrl+V triggers a clipboard paste
export const CLIPBOARD_PASTE_SIGNAL = '\x00__CLIPBOARD_PASTE__\x00';

export async function promptUser(prompt: string = '❯ ', history?: string[], clipboardCheck?: () => boolean): Promise<string> {
    // Ensure stdin is in line mode and active before creating readline
    if (process.stdin.isTTY && process.stdin.isRaw) {
        process.stdin.setRawMode(false);
    }
    if (process.stdin.isPaused()) {
        process.stdin.resume();
    }

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        history: history ?? [],
        historySize: 500,
        removeHistoryDuplicates: true,
    });

    // Intercept Ctrl+V to trigger clipboard image paste
    let ctrlVTriggered = false;
    if (clipboardCheck && process.stdin.isTTY) {
        const origTtyWrite = (rl as any)._ttyWrite;
        if (typeof origTtyWrite === 'function') {
            (rl as any)._ttyWrite = function (s: string, key: any) {
                if (key && key.ctrl && key.name === 'v') {
                    if (clipboardCheck()) {
                        ctrlVTriggered = true;
                        rl.close();
                        return;
                    }
                    // No image on clipboard — fall through to normal readline behavior
                }
                origTtyWrite.call(this, s, key);
            };
        }
    }

    return new Promise((resolve) => {
        let resolved = false;
        const safeResolve = (value: string) => {
            if (resolved) return;
            resolved = true;
            resolve(value);
        };

        rl.on('close', () => {
            if (ctrlVTriggered) {
                safeResolve(CLIPBOARD_PASTE_SIGNAL);
                return;
            }
            // Normal close (Ctrl+C, Ctrl+D) — resolve empty
            safeResolve('');
        });

        rl.question(prompt, (answer) => {
            if (!ctrlVTriggered) {
                safeResolve(answer.trim());
                rl.close();
            }
        });
    });
}

export async function confirmAction(description: string): Promise<boolean | string> {
    const wasSpinning = !!currentSpinner;
    const spinnerText = currentSpinner ? currentSpinner.text : '';
    stopSpinner();

    console.log();
    console.log(C.warn('  ┌─ Action requires approval ──────────────────────────'));
    for (const line of description.split('\n').slice(0, 12)) {
        console.log(C.muted(`  │ `) + chalk.dim(line));
    }
    console.log(C.warn('  └──────────────────────────────────────────────────────'));
    console.log();

    const { selectPrompt } = await import('./select.js');
    const choice = await selectPrompt([
        { label: 'Allow', value: 'allow', hint: 'proceed with this action' },
        { label: 'Deny', value: 'deny', hint: 'skip this action' },
        { label: 'Edit', value: 'edit', hint: 'provide feedback' },
    ]);

    let result: boolean | string;
    if (choice === 'allow') {
        result = true;
    } else if (choice === 'edit') {
        const feedback = await promptUser(C.accent('  feedback ') + C.muted('❯ '));
        result = feedback || false;
    } else {
        result = false;
    }

    if (result === true && wasSpinning) startSpinner(spinnerText);
    return result;
}

// ─── Header ───────────────────────────────────────────────

// 5-row pixel-art "DEEPA" (each letter is 7 chars wide, 2-char gap between)
// Total art width: 41 chars
const PIXEL_ART = [
    ['██████ ', '███████', '███████', '██████ ', ' █████ '],
    ['██   ██', '██     ', '██     ', '██   ██', '██   ██'],
    ['██   ██', '█████  ', '█████  ', '██████ ', '███████'],
    ['██   ██', '██     ', '██     ', '██     ', '██   ██'],
    ['██████ ', '███████', '███████', '██     ', '██   ██'],
];

// Gradient: violet → indigo → sky → cyan → emerald
const ROW_COLORS = [
    chalk.hex('#C4B5FD'),   // violet-300
    chalk.hex('#A5B4FC'),   // indigo-300
    chalk.hex('#93C5FD'),   // blue-300
    chalk.hex('#67E8F9'),   // cyan-300
    chalk.hex('#6EE7B7'),   // emerald-300
];

function center(text: string, visibleLen: number, cols: number): string {
    const pad = Math.max(0, Math.floor((cols - visibleLen) / 2));
    return ' '.repeat(pad) + text;
}

export function printHeader(): void {
    const cols = Math.min(process.stdout.columns || 80, 120);
    const artWidth = 41; // 5 × 7-char letters + 4 × 2-char gaps

    console.log();
    console.log();

    // Pixel art title — row by row with gradient colours
    for (let row = 0; row < 5; row++) {
        const colored = PIXEL_ART[row]
            .map((letter) => ROW_COLORS[row].bold(letter))
            .join('  ');                          // 2-char gap between letters
        console.log(center(colored, artWidth, cols));
    }

    console.log();

    // Tagline
    const tagline = 'Your agentic assistant  ·  think, plan, execute';
    console.log(center(chalk.hex('#9CA3AF').italic(tagline), tagline.length, cols));

    console.log();

    // Keyboard hints
    const hint = 'ENTER to send  •  / for commands  •  Ctrl+V paste image  •  ESC to cancel';
    console.log(center(chalk.hex('#4B5563')(hint), hint.length, cols));

    console.log();
    console.log();
}

// ─── DROID-style status bar ───────────────────────────────

export function printConfig(config: {
    provider: string;
    model: string;
    autonomy: string;
    mode: string;
    mcpServers?: number;
    mcpTools?: number;
}): void {
    const cols = Math.min(process.stdout.columns || 80, 120);

    const modeColor: Record<string, ReturnType<typeof chalk.hex>> = {
        exec: C.success,
        plan: C.warn,
        chat: C.accent,
    };
    const autonomyColor: Record<string, ReturnType<typeof chalk.hex>> = {
        high: C.tag,
        medium: C.warn,
        low: C.error,
    };
    const autonomyDesc: Record<string, string> = {
        high: 'only very-high risk actions require approval',
        medium: 'high/very-high risk actions require approval',
        low: 'all actions require approval',
    };

    const mc = modeColor[config.mode] ?? C.accent;
    const ac = autonomyColor[config.autonomy] ?? C.accent;
    const desc = autonomyDesc[config.autonomy] ?? '';

    // Left: mode (autonomy) — description
    const leftPlain = `${config.mode} (${config.autonomy})  —  ${desc}`;
    const leftStyled =
        mc.bold(config.mode) +
        C.muted(' (') + ac.bold(config.autonomy) + C.muted(')') +
        C.muted(`  —  ${desc}`);

    // Right: model · provider  [· mcp info]
    let rightPlain = `${config.model}  (${config.provider})`;
    let rightStyled = C.bright.bold(config.model) + C.muted(`  (${config.provider})`);
    if (config.mcpServers && config.mcpServers > 0) {
        const mcp = `  ·  ${config.mcpServers} mcp`;
        rightPlain += mcp;
        rightStyled += C.muted(mcp);
    }

    // Pad between left and right
    const gap = Math.max(2, cols - leftPlain.length - rightPlain.length - 4);
    const separator = C.muted(' '.repeat(gap));

    console.log('  ' + leftStyled + separator + rightStyled);

    // Thin divider line
    console.log('  ' + chalk.hex('#374151')('─'.repeat(cols - 4)));
    console.log();

    // Quick-ref hint line
    const hints = [
        ['/help', 'commands'],
        ['/quit', 'exit'],
        ['/plan', 'plan mode'],
        ['/exec', 'exec mode'],
        ['/model', 'models'],
    ];
    const hintLine = hints
        .map(([cmd, label]) => C.muted('/') + chalk.dim(cmd.slice(1)) + C.muted(`  ${label}`))
        .join(chalk.hex('#374151')('   ·   '));
    console.log('  ' + hintLine);
    console.log();
}

// ─── Tool call display ────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
    file_read: '◎',
    file_write: '✎',
    file_edit: '✐',
    file_list: '⊞',
    shell: '⌘',
    search_grep: '⌕',
    search_files: '⌕',
    web_fetch: '⌁',
    web_search: '⌁',
    todo: '☰',
    git_worktree: '⎇',
    use_skill: '⚡',
};

export function printToolCall(name: string, args: Record<string, unknown>): void {
    stopSpinner();

    const icon = TOOL_ICONS[name] ?? '◈';

    // Special treatment for skill activation — show prominent feedback
    if (name === 'use_skill' && typeof args.name === 'string') {
        console.log(
            '\n  ' +
            C.primary(icon) + '  ' +
            chalk.hex('#F59E0B').bold('activating skill') +
            C.muted('  ') + chalk.hex('#F59E0B')(args.name),
        );
        startSpinner(`loading skill ${args.name}…`);
        return;
    }

    // Special treatment for todo — render the task list inline
    if (name === 'todo' && Array.isArray(args.todos)) {
        const todos = args.todos as Array<{ content: string; status: string }>;
        const completed = todos.filter((t) => t.status === 'completed').length;
        const total = todos.length;
        const inProgress = todos.find((t) => t.status === 'in_progress');
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

        // Progress bar
        const barWidth = 20;
        const filled = Math.round((completed / total) * barWidth);
        const bar = C.success('█'.repeat(filled)) + C.muted('░'.repeat(barWidth - filled));

        console.log('\n  ' + C.primary(icon) + '  ' + C.accent.bold('tasks') + C.muted(`  ${completed}/${total}`) + `  ${bar}  ${C.muted(pct + '%')}`);

        for (const todo of todos) {
            let statusIcon: string;
            let line: string;
            switch (todo.status) {
                case 'completed':
                    statusIcon = C.success('✓');
                    line = chalk.dim.strikethrough(todo.content);
                    break;
                case 'in_progress':
                    statusIcon = chalk.hex('#F59E0B')('▸');
                    line = chalk.hex('#F59E0B').bold(todo.content);
                    break;
                default:
                    statusIcon = C.muted('○');
                    line = C.muted(todo.content);
            }
            console.log(`    ${statusIcon} ${line}`);
        }

        if (inProgress) {
            startSpinner(inProgress.content + '…');
        }
        return;
    }

    const primary = args.path ?? args.command ?? args.query ?? args.url ?? args.action ?? '';
    const hint = typeof primary === 'string' && primary
        ? C.muted('  ') + chalk.dim(primary.length > 72 ? primary.slice(0, 72) + '…' : primary)
        : '';

    console.log(
        '\n  ' +
        C.primary(icon) + '  ' +
        C.accent.bold(name) +
        hint,
    );

    startSpinner(`running ${name}…`);
}

export function printToolResult(name: string, result: string, isError: boolean): void {
    stopSpinner();

    if (isError) {
        console.log('  ' + C.error('✗') + ' ' + C.muted(name));
        const preview = result.split('\n').slice(0, 4).join('\n');
        if (preview.trim()) {
            for (const line of preview.split('\n')) {
                console.log('    ' + C.error.dim(line));
            }
        }
    } else if (name === 'use_skill') {
        // Extract skill name from result (format: "# Skill: <name>")
        const skillMatch = result.match(/^# Skill: (.+)$/m);
        const skillName = skillMatch ? skillMatch[1] : 'unknown';
        console.log('  ' + C.success('✓') + ' ' + chalk.hex('#F59E0B')(`skill loaded: ${skillName}`) + C.muted('  — instructions provided to context'));
    } else if (name === 'todo') {
        // Already rendered in printToolCall — just show minimal confirmation
        stopSpinner();
    } else {
        console.log('  ' + C.success('✓') + ' ' + C.muted(name));
        const lines = result.split('\n');
        const maxPreview = 20;
        const preview = lines.slice(0, maxPreview).join('\n');
        if (preview.trim()) {
            for (const line of preview.split('\n')) {
                console.log('    ' + chalk.dim(line));
            }
        }
        if (lines.length > maxPreview) {
            console.log('    ' + C.muted(`… ${lines.length - maxPreview} more lines`));
        }
    }
}

// ─── Assistant output ─────────────────────────────────────

export function printAssistant(text: string): void {
    stopSpinner();
    console.log('\n' + renderMarkdown(text));
}

// ─── Input prompt ─────────────────────────────────────────

export async function promptInput(history?: string[], clipboardCheck?: () => boolean): Promise<string> {
    return promptUser('\n' + C.primary('  ◆ ') + C.bright.bold('you  ') + C.muted('❯ '), history, clipboardCheck);
}

// ─── Status / error ───────────────────────────────────────

export function printError(message: string): void {
    stopSpinner();
    console.error('\n  ' + C.error('✗  ') + chalk.dim(message));
}

export function printSuccess(message: string): void {
    console.log('  ' + C.success('✓  ') + chalk.dim(message));
}

export function printInfo(message: string): void {
    console.log('  ' + C.accent('·  ') + chalk.dim(message));
}

export function printImageAttachment(fileName: string): void {
    const name = fileName.length > 40 ? '…' + fileName.slice(-39) : fileName;
    console.log(
        '\n  ' + C.accent('📎 ') +
        C.bright.bold('attached  ') +
        C.muted(name),
    );
}

// ─── Token usage line ─────────────────────────────────────

export function printTokenUsage(prompt: number, completion: number, totalP: number, totalC: number): void {
    if (!process.env.DEEPA_SHOW_TOKENS) return;
    console.log(
        C.muted(`  tokens  `) +
        chalk.dim(`this turn: ${prompt + completion}`) +
        C.muted('  ·  ') +
        chalk.dim(`session: ${totalP + totalC}`),
    );
}

// ─── Help ─────────────────────────────────────────────────

export function printHelp(): void {
    console.log();
    console.log('  ' + C.primary.bold('◆') + '  ' + C.bright.bold('Commands'));
    console.log();

    const section = (title: string) =>
        console.log('  ' + C.accent(title));

    const cmd = (name: string, desc: string) =>
        console.log(`    ${C.bright('/' + name.padEnd(22))}${C.muted(desc)}`);

    section('Session');
    cmd('help', 'show this help');
    cmd('quit / exit', 'end the session');
    cmd('clear', 'clear conversation history');
    cmd('compact', 'summarise and shrink history');
    cmd('session', 'show session details');
    cmd('memory', 'show loaded memory entries');
    console.log();

    section('Mode');
    cmd('exec', 'autonomous execution (plan → run → verify)');
    cmd('plan', 'plan only — no file changes');
    cmd('chat', 'conversational mode');
    cmd('autonomy <level>', 'set autonomy: low · medium · high');
    console.log();

    section('Models');
    cmd('model', 'list configured models');
    cmd('model add', 'add a new model interactively');
    cmd('model use <name>', 'switch to a named model');
    cmd('model default <name>', 'set default model');
    cmd('model remove <name>', 'remove a model');
    console.log();

    section('MCP Servers');
    cmd('mcp', 'list MCP servers');
    cmd('mcp add <name> <cmd>', 'add a local MCP server');
    cmd('mcp add-remote <name> <url>', 'add a remote MCP server');
    cmd('mcp remove <name>', 'remove an MCP server');
    console.log();

    section('Skills');
    cmd('skills', 'list available skills');
    console.log();

    section('Other');
    cmd('image <path> [msg]', 'send an image to the assistant');
    cmd('paste [msg]', 'send clipboard image (macOS)');
    console.log();
}

// ─── Escape key cancellation ─────────────────────────────

// Ensure emitKeypressEvents is called only once to avoid corrupting stdin
let keypressInitialised = false;

/**
 * Listen for Escape key press during LLM processing.
 * Returns an AbortController — call abort() when Escape is pressed.
 * Call cleanup() to stop listening (e.g., after processing completes).
 */
export function listenForEscape(): { controller: AbortController; cleanup: () => void } {
    const controller = new AbortController();

    if (process.stdin.isTTY) {
        // Only patch stdin once — calling emitKeypressEvents multiple times
        // can corrupt the stream's internal decoder state
        if (!keypressInitialised) {
            emitKeypressEvents(process.stdin);
            keypressInitialised = true;
        }
        process.stdin.setRawMode(true);
        process.stdin.resume();
    }

    const onKeypress = (_ch: string, key?: { name?: string; ctrl?: boolean }) => {
        if (!key) return;
        // Escape key or Ctrl+C
        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
            controller.abort();
            stopSpinner();
            console.log('\n  ' + C.warn('⚠') + '  ' + chalk.dim('cancelled'));
        }
    };

    process.stdin.on('keypress', onKeypress);

    const cleanup = () => {
        process.stdin.removeListener('keypress', onKeypress);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
            // Do NOT pause stdin here — readline needs it active for the
            // next promptInput() call.  Pausing would leave the REPL unable
            // to accept input after a cancel.
        }
    };

    return { controller, cleanup };
}
