// ─── Interactive arrow-key selection prompt ───
// Renders a list of options the user can navigate with arrows and select with Enter.

import chalk from 'chalk';
import { emitKeypressEvents } from 'readline';
import { C } from './renderer.js';

export interface SelectOption {
    label: string;
    value: string;
    hint?: string;
}

// Track whether we've already patched stdin for keypress events
let keypressPatched = false;

/**
 * Show an interactive selection prompt.
 * User navigates with Up/Down arrows, selects with Enter, cancels with Escape.
 * Returns the `value` of the selected option, or 'deny' on Escape.
 */
export async function selectPrompt(options: SelectOption[]): Promise<string> {
    if (!process.stdin.isTTY) {
        // Fallback for non-TTY: return first option
        return options[0]?.value ?? '';
    }

    return new Promise<string>((resolve) => {
        let selectedIndex = 0;
        let resolved = false;

        // Ensure keypress events are emitted (idempotent guard)
        if (!keypressPatched) {
            emitKeypressEvents(process.stdin);
            keypressPatched = true;
        }

        const wasRaw = process.stdin.isRaw;
        process.stdin.setRawMode(true);
        process.stdin.resume();

        function render() {
            // Move cursor up to clear previous render (skip first render)
            if (selectedIndex !== -1) {
                // Clear the option lines
                for (let i = 0; i < options.length; i++) {
                    process.stdout.write('\x1b[2K'); // Clear current line
                    if (i < options.length - 1) {
                        process.stdout.write('\x1b[1A'); // Move up
                    }
                }
                process.stdout.write('\r'); // Return to start of line
            }

            // Render options
            for (let i = 0; i < options.length; i++) {
                const opt = options[i];
                const isSelected = i === selectedIndex;
                const prefix = isSelected ? C.primary('  ❯ ') : '    ';
                const label = isSelected ? C.bright.bold(opt.label) : C.muted(opt.label);
                const hint = opt.hint ? chalk.dim(`  ${opt.hint}`) : '';
                process.stdout.write(prefix + label + hint);
                if (i < options.length - 1) {
                    process.stdout.write('\n');
                }
            }
        }

        function cleanup() {
            process.stdin.removeListener('keypress', onKeypress);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(wasRaw ?? false);
            }
        }

        function onKeypress(_ch: string, key?: { name?: string; ctrl?: boolean }) {
            if (!key || resolved) return;

            if (key.name === 'up') {
                selectedIndex = (selectedIndex - 1 + options.length) % options.length;
                render();
            } else if (key.name === 'down') {
                selectedIndex = (selectedIndex + 1) % options.length;
                render();
            } else if (key.name === 'return') {
                resolved = true;
                cleanup();
                process.stdout.write('\n');
                resolve(options[selectedIndex].value);
            } else if (key.name === 'escape') {
                resolved = true;
                cleanup();
                process.stdout.write('\n');
                resolve('deny');
            } else if (key.ctrl && key.name === 'c') {
                resolved = true;
                cleanup();
                process.stdout.write('\n');
                resolve('deny');
            }
        }

        process.stdin.on('keypress', onKeypress);

        // Initial render
        render();
    });
}
