#!/usr/bin/env node
// ─── Deepa — Agentic Assistant ───

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, type CLIFlags } from './config.js';
import { createProvider } from './providers/registry.js';
import { ToolRegistry } from './tools/registry.js';
import { runAgentLoop } from './agent/loop.js';
import { loadAgentsMd } from './context/agents-md.js';
import { loadMemory } from './context/memory.js';
import { createSession, saveSession, loadLatestSession, type Session } from './context/history.js';
import { loadSkills } from './plugins/skills.js';
import { connectMCPServers, disconnectMCPServers, type MCPConnection } from './mcp/client.js';
import {
    addModel, removeModel, listModels, setDefaultModel, getModel,
    PROVIDER_PRESETS, type StoredModel,
} from './store/models.js';
import { addMcpServer, removeMcpServer, listMcpServers } from './store/mcp.js';
import { startConfigServer } from './server/index.js';
import { startIpcServer } from './server/ipc.js';
import {
    printHeader,
    printConfig,
    printHelp,
    printToolCall,
    printToolResult,
    printAssistant,
    printError,
    printInfo,
    printTokenUsage,
    promptUser,
    promptInput,
    confirmAction,
    startSpinner,
    stopSpinner,
} from './ui/renderer.js';
import type { Message, AgentMode } from './types.js';

// Import built-in tools
import { fileReadTool } from './tools/file-read.js';
import { fileWriteTool } from './tools/file-write.js';
import { fileEditTool } from './tools/file-edit.js';
import { fileListTool } from './tools/file-list.js';
import { searchGrepTool } from './tools/search-grep.js';
import { searchFilesTool } from './tools/search-files.js';
import { shellTool } from './tools/shell.js';
import { webFetchTool } from './tools/web-fetch.js';
import { webSearchTool } from './tools/web-search.js';
import { todoTool } from './tools/todo.js';
import { gitWorktreeTool } from './tools/worktree.js';

// ────────────────── CLI Setup ──────────────────

const program = new Command();

program
    .name('deepa')
    .description('Agentic assistant for the terminal — think, plan, execute')
    .version('0.1.0')
    .option('-p, --provider <type>', 'LLM provider (openai, anthropic, ollama, lmstudio, custom)')
    .option('-m, --model <name>', 'Model name')
    .option('-b, --base-url <url>', 'API base URL')
    .option('-k, --api-key <key>', 'API key')
    .option('-u, --use-model <name>', 'Use a named stored model')
    .option('-a, --autonomy <level>', 'Autonomy level (suggest, ask, auto)')
    .option('--verbose', 'Enable verbose logging')
    .option('--resume', 'Resume the latest session')
    .argument('[prompt...]', 'Initial prompt (optional)')
    .action(async (promptParts: string[], flags: CLIFlags & { resume?: boolean }) => {
        await runInteractive(promptParts.join(' '), flags);
    });

// ─── Model management subcommands ───

const modelCmd = program.command('model').description('Manage LLM model configurations');

modelCmd
    .command('add')
    .description('Add a new model configuration (interactive)')
    .action(async () => {
        await addModelInteractive();
    });

modelCmd
    .command('list')
    .description('List all configured models')
    .action(() => {
        const models = listModels();
        if (models.length === 0) {
            console.log(chalk.dim('  No models configured. Run `deepa model add` to add one.'));
            return;
        }
        console.log(chalk.bold('\n  Configured Models:\n'));
        for (const m of models) {
            const defaultBadge = m.isDefault ? chalk.green(' ★ default') : '';
            console.log(`  ${chalk.cyan(m.name)}${defaultBadge}`);
            console.log(chalk.dim(`    Provider: ${m.provider} | Model: ${m.model}`));
            console.log(chalk.dim(`    Endpoint: ${m.baseUrl}`));
            if (m.apiKeyMasked) {
                console.log(chalk.dim(`    API Key:  ${m.apiKeyMasked}`));
            }
            console.log('');
        }
    });

modelCmd
    .command('remove <name>')
    .description('Remove a model configuration')
    .action((name: string) => {
        if (removeModel(name)) {
            console.log(chalk.green(`  ✓ Removed model "${name}"`));
        } else {
            console.log(chalk.red(`  ✗ Model "${name}" not found`));
        }
    });

modelCmd
    .command('default <name>')
    .description('Set a model as the default')
    .action((name: string) => {
        if (setDefaultModel(name)) {
            console.log(chalk.green(`  ✓ Default model set to "${name}"`));
        } else {
            console.log(chalk.red(`  ✗ Model "${name}" not found`));
        }
    });

// ─── MCP management subcommands ───

const mcpCmd = program.command('mcp').description('Manage MCP server configurations');

mcpCmd
    .command('add <name> <command> [args...]')
    .description('Add a local MCP server (e.g., deepa mcp add fs npx -y @modelcontextprotocol/server-filesystem /tmp)')
    .action((name: string, command: string, args: string[]) => {
        addMcpServer(name, { command, args: args.length > 0 ? args : undefined });
        console.log(chalk.green(`  ✓ Added MCP server "${name}": ${command} ${args.join(' ')}`));
    });

mcpCmd
    .command('add-remote <name> <url> [transport]')
    .description('Add a remote MCP server using Server-Sent Events (SSE) or HTTP stream. Transport can be sse or http')
    .action((name: string, url: string, transport?: string) => {
        addMcpServer(name, { url, transport: transport as 'sse' | 'http' | undefined });
        console.log(chalk.green(`  ✓ Added remote MCP server "${name}" at ${url}${transport ? ` (${transport})` : ''}`));
    });

mcpCmd
    .command('remove <name>')
    .description('Remove an MCP server')
    .action((name: string) => {
        if (removeMcpServer(name)) {
            console.log(chalk.green(`  ✓ Removed MCP server "${name}"`));
        } else {
            console.log(chalk.red(`  ✗ MCP server "${name}" not found`));
        }
    });

mcpCmd
    .command('list')
    .description('List configured MCP servers')
    .action(() => {
        const servers = listMcpServers();
        const names = Object.keys(servers);
        if (names.length === 0) {
            console.log(chalk.dim('  No MCP servers configured. Run `deepa mcp add <name> <command>` to add one.'));
            return;
        }
        console.log(chalk.bold('\n  MCP Servers:\n'));
        for (const name of names) {
            const s = servers[name];
            console.log(`  ${chalk.cyan(name)}`);
            if (s.url) {
                console.log(chalk.dim(`    Remote URL: ${s.url}`));
            } else {
                console.log(chalk.dim(`    Command: ${s.command} ${(s.args || []).join(' ')}`));
            }
            console.log('');
        }
    });

// ─── Config UI subcommand ───

program
    .command('config-ui')
    .description('Launch the Local Web Configuration UI')
    .option('-p, --port <number>', 'Port to run the UI server on', '3000')
    .action(async (options: { port: string }) => {
        const port = parseInt(options.port, 10);
        await startConfigServer(port);
    });

// ─── Plan/exec subcommands ───

program
    .command('plan <prompt...>')
    .description('Generate an implementation plan without making changes')
    .option('-u, --use-model <name>', 'Use a named stored model')
    .action(async (promptParts: string[], flags: CLIFlags) => {
        flags.mode = 'plan';
        await runInteractive(promptParts.join(' '), flags);
    });

program
    .command('exec <prompt...>')
    .description('Execute a task with full tool access')
    .option('-u, --use-model <name>', 'Use a named stored model')
    .option('-a, --autonomy <level>', 'Autonomy level')
    .action(async (promptParts: string[], flags: CLIFlags) => {
        flags.mode = 'exec';
        await runInteractive(promptParts.join(' '), flags);
    });

program
    .command('serve-ipc')
    .description('Starts a headless JSON-RPC server on stdin/stdout for editor extensions')
    .option('-u, --use-model <name>', 'Use a named stored model')
    .option('-a, --autonomy <level>', 'Autonomy level')
    .option('--resume', 'Resume the latest session')
    .action(async (flags: CLIFlags & { resume?: boolean }) => {
        flags.mode = 'exec'; // IPC generally implies exec mode
        const cwd = process.cwd();
        const config = loadConfig(cwd, flags);

        // Build tool registry
        const tools = new ToolRegistry();
        tools.register(fileReadTool);
        tools.register(fileWriteTool);
        tools.register(fileEditTool);
        tools.register(fileListTool);
        tools.register(searchGrepTool);
        tools.register(searchFilesTool);
        tools.register(shellTool);
        tools.register(webFetchTool);
        tools.register(webSearchTool);
        tools.register(todoTool);
        tools.register(gitWorktreeTool);

        // Create provider
        const provider = createProvider(config.provider);

        // Connect MCP servers
        if (Object.keys(config.mcpServers).length > 0) {
            try {
                // Do not print connecting messages in IPC mode by setting verbose=false
                await connectMCPServers(config.mcpServers, tools, false);
            } catch (err) { }
        }

        const agentsMdContent = loadAgentsMd(cwd);
        const memoryContent = loadMemory(cwd);
        const skills = loadSkills(cwd);
        const skillDescriptions = skills.map((s) => `${s.name}: ${s.description}`);

        await startIpcServer({
            provider,
            tools,
            config,
            cwd,
            agentsMdContent,
            memoryContent,
            skillDescriptions,
            resume: flags.resume
        });
    });

// ────────────────── Interactive Model Add ──────────────────

async function addModelInteractive(): Promise<void> {
    console.log(chalk.bold('\n  Add a new model\n'));

    const name = await promptUser('  Name (e.g. gpt4, claude, local-llama): ');
    if (!name) { console.log(chalk.dim('  Cancelled.')); return; }

    console.log(chalk.dim('  Providers: openai, anthropic, ollama, lmstudio, custom'));
    const provider = await promptUser('  Provider: ') as StoredModel['provider'];
    if (!provider) { console.log(chalk.dim('  Cancelled.')); return; }

    const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;

    const model = await promptUser(`  Model ID [${preset.defaultModel}]: `) || preset.defaultModel;
    const baseUrl = await promptUser(`  Base URL [${preset.baseUrl}]: `) || preset.baseUrl;

    let apiKey: string | undefined;
    if (preset.needsKey) {
        apiKey = await promptUser('  API Key: ');
        if (!apiKey) {
            console.log(chalk.yellow('  ⚠ No API key provided. You can add it later.'));
        }
    }

    const maxTokensStr = await promptUser('  Max tokens [4096]: ');
    const maxTokens = maxTokensStr ? parseInt(maxTokensStr) : 4096;

    const makeDefault = await promptUser('  Set as default? (y/n) [y]: ');
    const isDefault = !makeDefault || makeDefault.toLowerCase().startsWith('y');

    addModel({
        name,
        provider,
        model,
        baseUrl,
        apiKey: apiKey || undefined,
        maxTokens,
        isDefault,
    });

    console.log(chalk.green(`\n  ✓ Model "${name}" saved${isDefault ? ' (default)' : ''}`));
    console.log(chalk.dim(`  API key encrypted and stored in ~/.deepa/models.json`));
}

// ────────────────── Interactive Loop ──────────────────

async function runInteractive(initialPrompt: string, flags: CLIFlags & { resume?: boolean } = {}): Promise<void> {
    const cwd = process.cwd();
    const config = loadConfig(cwd, flags);

    // Check if we have a model configured
    if (!config.provider.apiKey && config.provider.type !== 'local') {
        console.log(chalk.yellow('\n  ⚠ No model configured. Run `deepa model add` to set up a provider.\n'));
        return;
    }

    // Build tool registry
    const tools = new ToolRegistry();
    tools.register(fileReadTool);
    tools.register(fileWriteTool);
    tools.register(fileEditTool);
    tools.register(fileListTool);
    tools.register(searchGrepTool);
    tools.register(searchFilesTool);
    tools.register(shellTool);
    tools.register(webFetchTool);
    tools.register(webSearchTool);
    tools.register(todoTool);
    tools.register(gitWorktreeTool);

    // Create provider
    let provider: import('./providers/base.js').LLMProvider;
    try {
        provider = createProvider(config.provider);
    } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    // Connect MCP servers
    let mcpConnections: MCPConnection[] = [];
    if (Object.keys(config.mcpServers).length > 0) {
        try {
            mcpConnections = await connectMCPServers(config.mcpServers, tools, config.verbose);
        } catch (err) {
            if (config.verbose) {
                console.error(chalk.dim(`  ⚠ MCP init error: ${err instanceof Error ? err.message : String(err)}`));
            }
        }
    }

    // Load context
    const agentsMdContent = loadAgentsMd(cwd);
    const memoryContent = loadMemory(cwd);
    const skills = loadSkills(cwd);
    const skillDescriptions = skills.map((s) => `${s.name}: ${s.description}`);

    // Session
    let session: Session;
    if (flags.resume) {
        const existing = loadLatestSession(cwd);
        if (existing) {
            session = existing;
            printInfo(`resumed session  ·  ${session.id}`);
        } else {
            session = createSession(cwd);
        }
    } else {
        session = createSession(cwd);
    }

    // Print header
    const totalMcpTools = mcpConnections.reduce((sum, c) => sum + c.tools.length, 0);
    printHeader();
    printConfig({
        provider: config.provider.type,
        model: config.provider.model,
        autonomy: config.autonomy,
        mode: config.mode,
        mcpServers: mcpConnections.length || undefined,
        mcpTools: totalMcpTools || undefined,
    });

    if (flags.resume && session.messages.length > 0) {
        printInfo(`resumed session  ·  ${session.messages.length} messages`);
    }
    if (agentsMdContent) printInfo('AGENTS.md loaded');
    if (memoryContent) printInfo('memory loaded');
    if (skills.length > 0) printInfo(`${skills.length} skill${skills.length > 1 ? 's' : ''} loaded`);

    let currentMode = config.mode;
    let conversationHistory: Message[] = session.messages;

    // Handle initial prompt or interactive mode
    const processMessage = async (userInput: string): Promise<void> => {
        startSpinner('thinking…');
        let streamedText = '';

        try {
            const updatedConfig = { ...config, mode: currentMode };
            const messages = await runAgentLoop(userInput, conversationHistory, {
                provider,
                tools,
                config: updatedConfig,
                cwd,
                agentsMdContent,
                memoryContent,
                skillDescriptions,
                confirmAction,
                onText: (text) => {
                    stopSpinner();
                    process.stdout.write(text);
                    streamedText += text;
                },
                onToolCall: (name, args) => {
                    printToolCall(name, args);
                },
                onToolResult: (name, result, isError) => {
                    printToolResult(name, result, isError);
                },
                onTokenUsage: (p, c, tp, tc) => {
                    printTokenUsage(p, c, tp, tc);
                },
            });

            // If we streamed text, add a newline
            if (streamedText) {
                console.log('');
            }

            conversationHistory = messages;
            session.messages = messages;
            saveSession(session);
        } catch (err) {
            stopSpinner();
            printError(err instanceof Error ? err.message : String(err));
        }
    };

    // If initial prompt provided, run it
    if (initialPrompt) {
        await processMessage(initialPrompt);

        // If not in chat mode with initial prompt, exit after one cycle
        if (config.mode !== 'chat') {
            return;
        }
    }

    // Interactive REPL
    while (true) {
        const input = await promptInput();

        if (!input) continue;

        // Handle slash commands
        if (input.startsWith('/')) {
            const parts = input.slice(1).split(' ');
            const cmd = parts[0].toLowerCase();
            const args = parts.slice(1);

            switch (cmd) {
                case 'quit':
                case 'exit':
                case 'q':
                    console.log('\n  ' + chalk.hex('#7C3AED').bold('◆') + chalk.dim('  see you later\n'));
                    saveSession(session);
                    await disconnectMCPServers(mcpConnections);
                    process.exit(0);
                    break;

                case 'help':
                case 'h':
                    printHelp();
                    break;

                case 'clear':
                    conversationHistory = [];
                    session.messages = [];
                    printInfo('conversation cleared');
                    break;

                case 'plan':
                    currentMode = 'plan';
                    printInfo('mode → plan  (read-only)');
                    break;

                case 'exec':
                    currentMode = 'exec';
                    printInfo('mode → exec  (autonomous)');
                    break;

                case 'chat':
                    currentMode = 'chat';
                    printInfo('mode → chat  (conversational)');
                    break;

                // ─── /model commands ───
                case 'model': {
                    const subcmd = args[0];
                    if (subcmd === 'add') {
                        await addModelInteractive();
                    } else if (subcmd === 'list' || !subcmd) {
                        const models = listModels();
                        if (models.length === 0) {
                            console.log(chalk.dim('  No models. Use /model add'));
                        } else {
                            for (const m of models) {
                                const badge = m.isDefault ? chalk.green(' ★') : '';
                                console.log(chalk.dim(`  ${chalk.cyan(m.name)}${badge} — ${m.provider}/${m.model} (${m.baseUrl})`));
                            }
                        }
                    } else if (subcmd === 'remove' && args[1]) {
                        if (removeModel(args[1])) {
                            console.log(chalk.green(`  ✓ Removed "${args[1]}"`));
                        } else {
                            console.log(chalk.red(`  ✗ Not found: "${args[1]}"`));
                        }
                    } else if (subcmd === 'default' && args[1]) {
                        if (setDefaultModel(args[1])) {
                            console.log(chalk.green(`  ✓ Default set to "${args[1]}"`));
                        } else {
                            console.log(chalk.red(`  ✗ Not found: "${args[1]}"`));
                        }
                    } else if (subcmd === 'use' && args[1]) {
                        const m = getModel(args[1]);
                        if (m) {
                            config.provider = {
                                type: (m.provider === 'ollama' || m.provider === 'lmstudio' || m.provider === 'custom') ? 'local' : m.provider as 'openai' | 'anthropic',
                                apiKey: m.apiKey,
                                baseUrl: m.baseUrl,
                                model: m.model,
                                maxTokens: m.maxTokens,
                            };
                            provider = createProvider(config.provider);
                            console.log(chalk.green(`  ✓ Switched to "${args[1]}" (${m.provider}/${m.model})`));
                        } else {
                            console.log(chalk.red(`  ✗ Not found: "${args[1]}"`));
                        }
                    } else {
                        console.log(chalk.dim('  Usage: /model [add|list|remove <name>|default <name>|use <name>]'));
                    }
                    break;
                }

                // ─── /mcp commands ───
                case 'mcp': {
                    const subcmd = args[0];
                    if (subcmd === 'add' && args[1] && args[2]) {
                        const serverName = args[1];
                        const command = args[2];
                        const serverArgs = args.slice(3);
                        addMcpServer(serverName, { command, args: serverArgs.length > 0 ? serverArgs : undefined });
                        console.log(chalk.green(`  ✓ Added MCP server "${serverName}"`));
                        console.log(chalk.dim('  Restart to connect, or use `deepa mcp list` to verify.'));
                    } else if (subcmd === 'add-remote' && args[1] && args[2]) {
                        const serverName = args[1];
                        const url = args[2];
                        const transport = args[3] as 'sse' | 'http' | undefined;
                        addMcpServer(serverName, { url, transport });
                        console.log(chalk.green(`  ✓ Added remote MCP server "${serverName}" at ${url}${transport ? ` (${transport})` : ''}`));
                        console.log(chalk.dim('  Restart to connect, or use `deepa mcp list` to verify.'));
                    } else if (subcmd === 'remove' && args[1]) {
                        if (removeMcpServer(args[1])) {
                            console.log(chalk.green(`  ✓ Removed "${args[1]}"`));
                        } else {
                            console.log(chalk.red(`  ✗ Not found: "${args[1]}"`));
                        }
                    } else if (subcmd === 'list' || !subcmd) {
                        const servers = listMcpServers();
                        const names = Object.keys(servers);
                        if (names.length === 0) {
                            console.log(chalk.dim('  No MCP servers. Use /mcp add <name> <command> [args...]'));
                        } else {
                            for (const n of names) {
                                const s = servers[n];
                                if (s.url) {
                                    console.log(chalk.dim(`  ${chalk.cyan(n)} — Remote: ${s.url}`));
                                } else {
                                    console.log(chalk.dim(`  ${chalk.cyan(n)} — ${s.command} ${(s.args || []).join(' ')}`));
                                }
                            }
                        }
                        // Show connected
                        if (mcpConnections.length > 0) {
                            console.log(chalk.dim(`\n  Connected: ${mcpConnections.map(c => c.name).join(', ')}`));
                        }
                    } else {
                        console.log(chalk.dim('  Usage: /mcp [add <name> <cmd> [args]|add-remote <name> <url> [transport]|remove <name>|list]'));
                    }
                    break;
                }

                case 'autonomy':
                    if (args[0] && ['suggest', 'ask', 'auto'].includes(args[0])) {
                        config.autonomy = args[0] as 'suggest' | 'ask' | 'auto';
                        printInfo(`autonomy → ${args[0]}`);
                    } else {
                        printInfo(`autonomy: ${config.autonomy}  ·  options: suggest · ask · auto`);
                    }
                    break;

                case 'memory':
                    if (memoryContent) {
                        console.log(chalk.dim('\n  Memory entries:'));
                        console.log(chalk.dim(`  ${memoryContent.split('\n').join('\n  ')}`));
                    } else {
                        console.log(chalk.dim('  No memory entries.'));
                    }
                    break;

                case 'session':
                    console.log(chalk.dim(`  Session: ${session.id}`));
                    console.log(chalk.dim(`  Messages: ${conversationHistory.length}`));
                    console.log(chalk.dim(`  Created: ${session.createdAt}`));
                    break;

                case 'compact':
                    if (conversationHistory.length > 4) {
                        const kept = conversationHistory.slice(-4);
                        conversationHistory = kept;
                        session.messages = kept;
                        saveSession(session);
                        printInfo(`compacted  ·  kept last ${kept.length} messages`);
                    } else {
                        printInfo('history already compact');
                    }
                    break;

                case 'config-ui':
                    const port = parseInt(args[0] || '3000', 10);
                    await startConfigServer(port);
                    break;

                default:
                    printInfo(`unknown command: /${cmd}  ·  /help for available commands`);
            }
            continue;
        }

        await processMessage(input);
    }
}

// ────────────────── Entry ──────────────────

program.parse();
