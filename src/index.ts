#!/usr/bin/env node
// ─── Deepa — Agentic Assistant ───

import os from 'os';
import path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, type CLIFlags } from './config.js';
import { createProvider } from './providers/registry.js';
import { ToolRegistry } from './tools/registry.js';
import { runAgentLoop } from './agent/loop.js';
import { loadAgentsMd } from './context/agents-md.js';
import { loadPrimaryMemoryIndex } from './context/memory.js';
import { createSession, saveSession, loadLatestSession, type Session } from './context/history.js';
import { compressConversationHistory } from './context/compression.js';
import { bootInkApp } from './cli/boot.js';
import { loadSkills } from './plugins/skills.js';
import { loadAgents } from './plugins/agents.js';
import { createUseSkillTool } from './tools/use-skill.js';
import { createSpawnAgentTool } from './tools/spawn-agent.js';
import { connectMCPServers, disconnectMCPServers, type MCPConnection } from './mcp/client.js';
import {
    addModel, removeModel, listModels, setDefaultModel, getModel,
    PROVIDER_PRESETS, type StoredModel,
} from './store/models.js';
import { addMcpServer, removeMcpServer, listMcpServers } from './store/mcp.js';
import { recordTokenUsage, getTokenSummary } from './store/tokens.js';

import { startUIServer } from './server/ui-server.js';
import open from 'open';
import {
    printHeader,
    printConfig,
    printHelp,
    printToolCall,
    printToolResult,
    printThinkingLine,
    printAssistant,
    printError,
    printInfo,
    printImageAttachment,
    printTokenUsage,
    promptUser,
    promptInput,
    confirmAction,
    startSpinner,
    stopSpinner,
    listenForEscape,
    CLIPBOARD_PASTE_SIGNAL,
} from './ui/renderer.js';
import type { Message, AgentMode } from './types.js';
import { loadInputHistory, saveInputHistory, appendToHistory } from './ui/history.js';
import { StreamingMarkdownRenderer } from './ui/stream-renderer.js';
import { isImagePath, loadImageAsBase64, extractImagePaths, clipboardHasImage, loadImageFromClipboard } from './ui/image.js';
import type { MessageContent, ImageContent } from './types.js';

// Import built-in tools
import { fileReadTool } from './tools/file-read.js';
import { fileWriteTool } from './tools/file-write.js';
import { fileEditTool } from './tools/file-edit.js';
import { fileListTool } from './tools/file-list.js';
import { searchGrepTool } from './tools/search-grep.js';
import { searchFilesTool } from './tools/search-files.js';
import { shellTool, killBackgroundProcesses } from './tools/shell.js';
import { webFetchTool } from './tools/web-fetch.js';
import { webSearchTool } from './tools/web-search.js';
import { todoTool } from './tools/todo.js';
import { gitWorktreeTool } from './tools/worktree.js';
import { thinkTool } from './tools/think.js';
import { askUserTool } from './tools/ask-user.js';

// ────────────────── CLI Setup ──────────────────

// Ensure background processes are cleaned up on exit / signals
process.on('exit', () => killBackgroundProcesses());
process.on('SIGINT', () => {
    killBackgroundProcesses();
    process.exit(0);
});
process.on('SIGTERM', () => {
    killBackgroundProcesses();
    process.exit(0);
});

const program = new Command();

import { createRequire } from 'module';
const __require = createRequire(import.meta.url);
const CLI_VERSION = __require('../package.json').version;

program
    .name('deepa')
    .description('Agentic assistant for the terminal — think, plan, execute')
    .version(CLI_VERSION)
    .option('-p, --provider <type>', 'LLM provider (openai, anthropic, azure, ollama, lmstudio, custom)')
    .option('-m, --model <name>', 'Model name')
    .option('-b, --base-url <url>', 'API base URL')
    .option('-k, --api-key <key>', 'API key')
    .option('-u, --use-model <name>', 'Use a named stored model')
    .option('-a, --autonomy <level>', 'Autonomy level (low, medium, high)')
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

// ─── Chat UI subcommand ───

program
    .command('ui')
    .description('Launch the Deepa graphical web interface')
    .option('-p, --port <number>', 'Port to run the UI server on', '3001')
    .action(async (options: { port: string }, flags: CLIFlags) => {
        const port = parseInt(options.port, 10);
        await startUIServer(port, flags);
        await open(`http://localhost:${port}`);
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
    .command('tokens')
    .description('Show token usage summary for a given month')
    .option('--month <month>', 'Month (1-12)', String(new Date().getMonth() + 1))
    .option('--year <year>', 'Year', String(new Date().getFullYear()))
    .action((opts: { month: string; year: string }) => {
        const month = parseInt(opts.month);
        const year = parseInt(opts.year);
        const monthName = new Date(year, month - 1).toLocaleString('en', { month: 'long' });
        const summary = getTokenSummary(month, year);

        console.log(chalk.bold(`\n  Token Usage — ${monthName} ${year}\n`));

        if (summary.length === 0) {
            console.log(chalk.dim('  No token usage recorded for this period.\n'));
            return;
        }

        const modelWidth = Math.max(30, ...summary.map((s) => s.model.length + 2));
        const header = `  ${'Model'.padEnd(modelWidth)}  ${'Prompt'.padStart(12)}  ${'Completion'.padStart(12)}  ${'Total'.padStart(12)}`;
        console.log(chalk.dim(header));
        console.log(chalk.dim(`  ${'─'.repeat(modelWidth)}  ${'─'.repeat(12)}  ${'─'.repeat(12)}  ${'─'.repeat(12)}`));

        let grandPrompt = 0;
        let grandCompletion = 0;
        for (const s of summary) {
            grandPrompt += s.promptTokens;
            grandCompletion += s.completionTokens;
            console.log(
                `  ${chalk.white(s.model.padEnd(modelWidth))}  ${chalk.dim(s.promptTokens.toLocaleString().padStart(12))}  ${chalk.dim(s.completionTokens.toLocaleString().padStart(12))}  ${chalk.bold(s.totalTokens.toLocaleString().padStart(12))}`,
            );
        }

        const grandTotal = grandPrompt + grandCompletion;
        console.log(chalk.dim(`  ${'─'.repeat(modelWidth)}  ${'─'.repeat(12)}  ${'─'.repeat(12)}  ${'─'.repeat(12)}`));
        console.log(
            `  ${chalk.bold('Total'.padEnd(modelWidth))}  ${chalk.dim(grandPrompt.toLocaleString().padStart(12))}  ${chalk.dim(grandCompletion.toLocaleString().padStart(12))}  ${chalk.bold(grandTotal.toLocaleString().padStart(12))}`,
        );
        console.log();
    });

program
    .command('reset')
    .description('Factory reset — delete all sessions, memory, models, and configs from ~/.deepa')
    .action(async () => {
        console.log(chalk.yellow('\n  ⚠ This will delete everything in ~/.deepa:'));
        console.log(chalk.dim('    Sessions, memory, models, MCP configs, tokens, plugins, skills\n'));

        const confirm = await promptUser('  Type "yes" to confirm: ');
        if (confirm?.toLowerCase() !== 'yes') {
            console.log(chalk.dim('  Cancelled.\n'));
            return;
        }

        const deepaDir = path.join(os.homedir(), '.deepa');
        const { rmSync, existsSync } = await import('fs');
        if (existsSync(deepaDir)) {
            rmSync(deepaDir, { recursive: true, force: true });
            console.log(chalk.green('\n  ✨ Factory reset complete. All data in ~/.deepa has been deleted.\n'));
        } else {
            console.log(chalk.dim('\n  Nothing to reset — ~/.deepa does not exist.\n'));
        }
    });

// ────────────────── Interactive Model Add ──────────────────

async function addModelInteractive(): Promise<void> {
    console.log(chalk.bold('\n  Add a new model\n'));

    const name = await promptUser('  Name (e.g. gpt4, claude, local-llama): ');
    if (!name) { console.log(chalk.dim('  Cancelled.')); return; }

    console.log(chalk.dim('  Providers: openai, anthropic, azure, ollama, lmstudio, custom'));
    const provider = await promptUser('  Provider: ') as StoredModel['provider'];
    if (!provider) { console.log(chalk.dim('  Cancelled.')); return; }

    const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;

    let model: string;
    let baseUrl: string;
    let apiKey: string | undefined;

    if (provider === 'azure') {
        console.log(chalk.dim('\n  Azure OpenAI setup:'));

        const endpoint = await promptUser('  Endpoint URL (e.g. https://my-resource.openai.azure.com): ');
        if (!endpoint) { console.log(chalk.dim('  Cancelled.')); return; }

        const deployment = await promptUser('  Deployment name: ');
        if (!deployment) { console.log(chalk.dim('  Cancelled.')); return; }

        const apiVersion = await promptUser('  API version [2024-10-21]: ') || '2024-10-21';

        const cleanEndpoint = endpoint.replace(/\/+$/, '');
        model = deployment;
        baseUrl = `${cleanEndpoint}/openai/deployments/${deployment}?api-version=${apiVersion}`;

        console.log(chalk.dim(`\n  Endpoint: ${baseUrl}/chat/completions`));
    } else {
        model = await promptUser(`  Model ID [${preset.defaultModel}]: `) || preset.defaultModel;
        baseUrl = await promptUser(`  Base URL [${preset.baseUrl}]: `) || preset.baseUrl;
    }

    if (preset.needsKey && !apiKey) {
        apiKey = await promptUser('  API Key: ');
        if (!apiKey) {
            console.log(chalk.yellow('  ⚠ No API key provided. You can add it later.'));
        }
    }

    const maxTokensStr = await promptUser('  Max tokens [16384]: ');
    const maxTokens = maxTokensStr ? parseInt(maxTokensStr) : 16384;

    let useMaxCompletionTokens = false;
    if (provider === 'azure') {
        // Azure always uses max_completion_tokens
        useMaxCompletionTokens = true;
    } else if (provider === 'custom' || provider === 'openai') {
        const useOldStr = await promptUser('  Use `max_completion_tokens` instead of `max_tokens`? (y/n) [n]: ');
        useMaxCompletionTokens = useOldStr?.toLowerCase().startsWith('y') || false;
    }

    // Reasoning level for OpenAI o-series or Azure o-series models
    let reasoningEffort: StoredModel['reasoningEffort'] | undefined;
    if (provider === 'openai' || provider === 'azure') {
        const isOSeries = /\bo[1-9](-|\b)/.test(model) || model.includes('o4') || model.includes('o3');
        if (isOSeries) {
            console.log(chalk.dim('  This looks like an o-series reasoning model.'));
            const effortStr = await promptUser('  Reasoning effort (low/medium/high) [medium]: ') || 'medium';
            if (['low', 'medium', 'high'].includes(effortStr)) {
                reasoningEffort = effortStr as StoredModel['reasoningEffort'];
            }
        }
    }

    // Extended thinking budget for Anthropic claude-opus-4 / claude-sonnet-4 models
    let thinkingBudget: number | undefined;
    if (provider === 'anthropic') {
        const supportsThinking = model.includes('claude-opus-4') || model.includes('claude-sonnet-4');
        if (supportsThinking) {
            console.log(chalk.dim('  This model supports extended thinking (min 1024 tokens).'));
            const budgetStr = await promptUser('  Extended thinking budget_tokens (0 = disabled) [0]: ') || '0';
            const budget = parseInt(budgetStr);
            if (!isNaN(budget) && budget >= 1024) {
                thinkingBudget = budget;
            }
        }
    }

    const makeDefault = await promptUser('  Set as default? (y/n) [y]: ');
    const isDefault = !makeDefault || makeDefault.toLowerCase().startsWith('y');

    addModel({
        name,
        provider,
        model,
        baseUrl,
        apiKey: apiKey || undefined,
        maxTokens,
        useMaxCompletionTokens,
        reasoningEffort,
        thinkingBudget,
        isDefault,
    });

    console.log(chalk.green(`\n  ✓ Model "${name}" saved${isDefault ? ' (default)' : ''}`));
    console.log(chalk.dim(`  API key encrypted and stored in ~/.deepa/models.json`));
}

// ────────────────── Interactive Loop ──────────────────

async function runInteractive(initialPrompt: string, flags: CLIFlags & { resume?: boolean } = {}): Promise<void> {
    const cwd = process.cwd();

    // First-run: if no models configured, launch interactive setup
    const existingModels = listModels();
    if (existingModels.length === 0) {
        console.log(chalk.bold('\n  Welcome to Deepa!'));
        console.log(chalk.dim('  No models configured yet. Let\'s set one up.\n'));
        await addModelInteractive();

        // If user cancelled and still no models, exit
        if (listModels().length === 0) {
            console.log(chalk.yellow('\n  No model configured. Run `deepa model add` when ready.\n'));
            return;
        }
    }

    const config = loadConfig(cwd, flags);

    // Check if cloud provider has API key
    if (!config.provider.apiKey && config.provider.type !== 'local') {
        console.log(chalk.yellow('\n  ⚠ No API key for this model. Run `deepa model add` to reconfigure.\n'));
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
    tools.register(thinkTool);
    tools.register(askUserTool);

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

    const skillRegistry = loadSkills(cwd);
    const skillDescriptions = skillRegistry.getDescriptions();

    // Load agents
    const agentRegistry = loadAgents(cwd);
    const agentDescriptions = agentRegistry.getDescriptions();

    // Register use_skill tool if skills exist (progressive disclosure)
    if (skillRegistry.size > 0) {
        tools.register(createUseSkillTool(skillRegistry));
    }

    // Register spawn_agent tool if agents exist
    if (agentRegistry.size > 0) {
        tools.register(createSpawnAgentTool(agentRegistry, tools, provider, config));
    }

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

    if (skillRegistry.size > 0) printInfo(`${skillRegistry.size} skill${skillRegistry.size > 1 ? 's' : ''} loaded`);
    if (agentRegistry.size > 0) printInfo(`${agentRegistry.size} agent${agentRegistry.size > 1 ? 's' : ''} loaded  ·  /agents to list`);

    let currentMode = config.mode;
    let conversationHistory: Message[] = session.messages;

    // Handle initial prompt or interactive mode using the new Ink UI architecture
    try {
        await bootInkApp({
            initialHistory: conversationHistory,
            provider,
            tools,
            config: { ...config, mode: currentMode },
            cwd,
            agentsMdContent,
            skillDescriptions,
            agentDescriptions: agentRegistry.size > 0 ? agentDescriptions : undefined,
            confirmAction,
            initialPrompt,
            mcpConnections,
            onSessionSave: (messages) => {
                session.messages = messages;
                saveSession(session);
            },
        });
    } catch (e) {
        printError(`Fatal UI error: ${e}`);
    }

    // Cleanup when Ink exits
    saveSession(session);
    await disconnectMCPServers(mcpConnections);
    killBackgroundProcesses();
}

// ────────────────── Entry ──────────────────

program.parse();
