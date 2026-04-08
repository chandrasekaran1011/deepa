import { loadPrimaryMemoryIndex } from '../context/memory.js';
import { loadLatestSession } from '../context/history.js';
import type { AgentMode, AutonomyLevel } from '../types.js';

interface SlashCommandContext {
    messagesLength: number;
    cwd: string;
    addSystemMessage: (text: string) => void;
    clearMessages: () => void;
    submitMessage: (payload: string | any[]) => void;
    triggerCompact: () => void;
    exitFunc: () => void;
    skillDescriptions?: string[];
    agentDescriptions?: string[];
    setMode?: (mode: AgentMode) => void;
    setAutonomy?: (level: AutonomyLevel) => void;
    switchProvider?: (modelName: string) => void;
    mcpConnections?: any[];
    handleClipboardPaste?: (messageText?: string) => void;
}

export async function handleSlashCommand(commandStr: string, context: SlashCommandContext): Promise<boolean> {
    const parts = commandStr.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    const {
        addSystemMessage, clearMessages, submitMessage, triggerCompact, exitFunc,
        messagesLength, cwd, skillDescriptions, agentDescriptions,
        setMode, setAutonomy, switchProvider, mcpConnections, handleClipboardPaste,
    } = context;

    switch (cmd) {
        case 'quit':
        case 'exit':
        case 'q':
            exitFunc();
            return true;

        case 'clear':
            clearMessages();
            addSystemMessage('Conversation cleared locally.');
            return true;

        case 'help':
        case 'h':
            addSystemMessage(
`◆ Deepa CLI Commands:
  /help, /h      Show this help menu
  /clear         Clear conversation history
  /session       Show active session details
  /quit, /q      Save and exit

  /skills        List available skills
  /agents        List available subagents
  /memory        Show current memory index
  /compact       Force deep history compaction

Modes & Settings:
  /plan          Specification planning mode (read-only, generates .deepa/specs/)
  /exec          Autonomous execution mode
  /autonomy <lvl> Set autonomy (low/medium/high)

Model & MCP:
  /model list    List saved model configurations
  /model use <n> Switch to a named model at runtime
  /mcp list                    List connected MCP servers
  /mcp add <name> <cmd> [args] Add an MCP server
  /mcp remove <name>           Remove an MCP server
  /mcp enable <name>           Enable a disabled server
  /mcp disable <name>          Disable a server

Media:
  /image <path> [msg]  Attach an image file
  /paste [msg]         Paste image from clipboard
  Ctrl+V               Paste image from clipboard`
            );
            return true;

        case 'plan':
            setMode?.('plan');
            addSystemMessage('mode → plan (read-only)');
            return true;

        case 'exec':
            setMode?.('exec');
            addSystemMessage('mode → exec (autonomous)');
            return true;

        case 'autonomy':
            if (args[0] && ['low', 'medium', 'high'].includes(args[0])) {
                setAutonomy?.(args[0] as AutonomyLevel);
                addSystemMessage(`autonomy → ${args[0]}`);
            } else {
                addSystemMessage(`autonomy: options: low · medium · high`);
            }
            return true;

        case 'session': {
            const currentSession = loadLatestSession(cwd);
            if (currentSession) {
                addSystemMessage(`Session: ${currentSession.id}\nMessages: ${messagesLength}\nCreated: ${currentSession.createdAt}`);
            } else {
                addSystemMessage(`Session details currently unavailable.`);
            }
            return true;
        }

        case 'memory': {
            const currentMemory = loadPrimaryMemoryIndex(cwd);
            if (currentMemory) {
                addSystemMessage(`Memory Index:\n${currentMemory}`);
            } else {
                addSystemMessage('Memory index is empty.');
            }
            return true;
        }

        case 'skills': {
            if (skillDescriptions && skillDescriptions.length > 0) {
                addSystemMessage(`Available Skills:\n\n${skillDescriptions.join('\n')}`);
            } else {
                addSystemMessage('No skills loaded.');
            }
            return true;
        }

        case 'agents': {
            if (agentDescriptions && agentDescriptions.length > 0) {
                addSystemMessage(`Available Agents:\n\n${agentDescriptions.join('\n')}`);
            } else {
                addSystemMessage('No agents loaded.');
            }
            return true;
        }

        case 'compact':
            triggerCompact();
            return true;

        case 'image': {
            if (!args[0]) {
                addSystemMessage('Usage: /image <path> [message]');
                return true;
            }
            try {
                const { loadImageAsBase64 } = await import('../ui/image.js');
                const imgPath = args[0];
                const msgText = args.slice(1).join(' ');
                const base64Data = await loadImageAsBase64(imgPath);
                const ext = imgPath.split('.').pop()?.toLowerCase();
                const mediaType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
                const content: any[] = [
                    { type: 'image', source: { type: 'base64', mediaType, data: base64Data } }
                ];
                if (msgText) content.push({ type: 'text', text: msgText });

                addSystemMessage(`Attached image: ${imgPath}`);
                submitMessage(content);
            } catch (err: any) {
                addSystemMessage(`Error loading image: ${err.message}`);
            }
            return true;
        }

        case 'paste': {
            const msgText = args.join(' ') || undefined;
            handleClipboardPaste?.(msgText);
            return true;
        }

        case 'model': {
            if (args[0] === 'list') {
                try {
                    const { listModels, getDefaultModel } = await import('../store/models.js');
                    const models = listModels();
                    const defaultModel = getDefaultModel();
                    if (models.length === 0) {
                        addSystemMessage('No stored models found. Run `deepa model add` globally to configure.');
                    } else {
                        const modelList = models.map((m: any) => {
                            const isDefault = defaultModel?.name === m.name ? ' (default)' : '';
                            return `◆ ${m.name}${isDefault}\n   provider: ${m.provider}\n   model: ${m.model}`;
                        }).join('\n\n');
                        addSystemMessage(`Stored Models:\n\n${modelList}`);
                    }
                } catch (err: any) {
                    addSystemMessage(`Error listing models: ${err.message}`);
                }
            } else if (args[0] === 'use' && args[1]) {
                switchProvider?.(args[1]);
            } else {
                addSystemMessage(
`Model Configuration:
  /model list       List saved configurations
  /model use <name> Switch to a named model at runtime

To add or remove models, run from your terminal:
  deepa model add
  deepa model remove <name>
  deepa model default <name>`
                );
            }
            return true;
        }

        case 'mcp': {
            if (args[0] === 'list') {
                if (!mcpConnections || mcpConnections.length === 0) {
                    addSystemMessage('No MCP servers connected.');
                } else {
                    const lines = mcpConnections.map((c: any) => {
                        const toolNames: string[] = c.tools as string[];
                        const regular = toolNames.filter(t => !t.includes('_list_resources') && !t.includes('_read_resource') && !t.includes('_prompt_'));
                        const resources = toolNames.filter(t => t.includes('_list_resources') || t.includes('_read_resource'));
                        const prompts = toolNames.filter(t => t.includes('_prompt_'));
                        const parts = [];
                        if (regular.length) parts.push(`tools: ${regular.join(', ')}`);
                        if (resources.length) parts.push(`resources: ${resources.join(', ')}`);
                        if (prompts.length) parts.push(`prompts: ${prompts.join(', ')}`);
                        return `◆ ${c.name}\n   ${parts.join('\n   ') || '(no tools)'}`;
                    }).join('\n\n');
                    addSystemMessage(`Connected MCP Servers:\n\n${lines}`);
                }
            } else if (args[0] === 'add' && args[1] && args[2]) {
                try {
                    const { addMcpServer } = await import('../store/mcp.js');
                    const name = args[1];
                    const command = args[2];
                    const cmdArgs = args.slice(3);
                    addMcpServer(name, { command, args: cmdArgs.length > 0 ? cmdArgs : undefined });
                    addSystemMessage(`Added MCP server "${name}". Restart to connect.`);
                } catch (err: any) {
                    addSystemMessage(`Error adding MCP server: ${err.message}`);
                }
            } else if (args[0] === 'remove' && args[1]) {
                try {
                    const { removeMcpServer } = await import('../store/mcp.js');
                    if (removeMcpServer(args[1])) {
                        addSystemMessage(`Removed MCP server "${args[1]}". Restart to take effect.`);
                    } else {
                        addSystemMessage(`MCP server "${args[1]}" not found.`);
                    }
                } catch (err: any) {
                    addSystemMessage(`Error removing MCP server: ${err.message}`);
                }
            } else if (args[0] === 'disable' && args[1]) {
                try {
                    const { disableMcpServer } = await import('../store/mcp.js');
                    if (disableMcpServer(args[1])) {
                        addSystemMessage(`MCP server "${args[1]}" disabled. Restart to take effect.`);
                    } else {
                        addSystemMessage(`MCP server "${args[1]}" not found.`);
                    }
                } catch (err: any) {
                    addSystemMessage(`Error disabling MCP server: ${err.message}`);
                }
            } else if (args[0] === 'enable' && args[1]) {
                try {
                    const { enableMcpServer } = await import('../store/mcp.js');
                    if (enableMcpServer(args[1])) {
                        addSystemMessage(`MCP server "${args[1]}" enabled. Restart to take effect.`);
                    } else {
                        addSystemMessage(`MCP server "${args[1]}" not found.`);
                    }
                } catch (err: any) {
                    addSystemMessage(`Error enabling MCP server: ${err.message}`);
                }
            } else {
                addSystemMessage(
`MCP Server Management:
  /mcp list                    List connected servers and tools
  /mcp add <name> <cmd> [args] Add a server config
  /mcp remove <name>           Remove a server config
  /mcp enable <name>           Enable a disabled server
  /mcp disable <name>          Disable a server without removing it

Changes to MCP servers require a restart to take effect.`
                );
            }
            return true;
        }

        default:
            addSystemMessage(`unknown command: /${cmd}  ·  type /help for available commands`);
            return true;
    }
}
