import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { unlinkSync, existsSync as fileExists } from 'fs';
import { homedir } from 'os';
import multer from 'multer';
import { runAgentLoop } from '../agent/loop.js';
import { CLIFlags, loadConfig } from '../config.js';
import { loadLatestSession, createSession, saveSession, loadSession, listSessions, Session } from '../context/history.js';
import { loadAgentsMd } from '../context/agents-md.js';
import { loadMemory } from '../context/memory.js';
import { createProvider } from '../providers/registry.js';
import { ToolRegistry } from '../tools/registry.js';
import { loadSkills } from '../plugins/skills.js';
import { createUseSkillTool } from '../tools/use-skill.js';
import { connectMCPServers, MCPConnection } from '../mcp/client.js';
import { listModels, getModel, addModel, removeModel, setDefaultModel, PROVIDER_PRESETS } from '../store/models.js';
import { addMcpServer, removeMcpServer, listMcpServers } from '../store/mcp.js';
import { recordTokenUsage } from '../store/tokens.js';
import chalk from 'chalk';
import type { Message, MessageContent } from '../types.js';

// Setup file tools
import { fileReadTool } from '../tools/file-read.js';
import { fileWriteTool } from '../tools/file-write.js';
import { fileEditTool } from '../tools/file-edit.js';
import { fileListTool } from '../tools/file-list.js';
import { searchGrepTool } from '../tools/search-grep.js';
import { searchFilesTool } from '../tools/search-files.js';
import { shellTool } from '../tools/shell.js';
import { webFetchTool } from '../tools/web-fetch.js';
import { webSearchTool } from '../tools/web-search.js';
import { todoTool } from '../tools/todo.js';
import { gitWorktreeTool } from '../tools/worktree.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper: get a short preview of a session for listing
function getSessionPreview(s: Session): string {
    for (const msg of s.messages) {
        if (msg.role === 'user') {
            const text = typeof msg.content === 'string'
                ? msg.content
                : (msg.content as any[]).find((c: any) => c.type === 'text')?.text || '';
            if (text) return text.slice(0, 80);
        }
    }
    return 'Empty session';
}

// Helper: convert internal Message[] to UI-friendly format for history restore
function convertMessagesToUI(messages: Message[]): any[] {
    const uiMessages: any[] = [];
    // Collect tool results for matching
    const toolResults = new Map<string, { content: string; isError: boolean }>();
    for (const msg of messages) {
        if (msg.role === 'tool' && Array.isArray(msg.content)) {
            for (const block of msg.content as any[]) {
                if (block.type === 'tool_result' && block.toolCallId) {
                    toolResults.set(block.toolCallId, {
                        content: block.content || '',
                        isError: !!block.isError,
                    });
                }
            }
        } else if (msg.role === 'tool' && typeof msg.content === 'string') {
            // Some providers use simple string content for tool messages
        }
    }

    let idCounter = 0;
    for (const msg of messages) {
        const genId = () => `hist-${idCounter++}-${Math.random().toString(36).slice(2, 6)}`;

        if (msg.role === 'user') {
            const text = typeof msg.content === 'string'
                ? msg.content
                : (msg.content as any[]).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
            uiMessages.push({
                id: genId(),
                role: 'user',
                content: text,
            });
        } else if (msg.role === 'assistant') {
            const toolCalls: any[] = [];
            let textContent = '';

            if (typeof msg.content === 'string') {
                textContent = msg.content;
            } else if (Array.isArray(msg.content)) {
                for (const block of msg.content as any[]) {
                    if (block.type === 'text') {
                        textContent += block.text;
                    } else if (block.type === 'tool_call') {
                        const result = toolResults.get(block.id);
                        toolCalls.push({
                            id: block.id,
                            name: block.name,
                            args: block.arguments || {},
                            status: result?.isError ? 'error' : 'success',
                            result: result?.content || '',
                        });
                    }
                }
            }

            uiMessages.push({
                id: genId(),
                role: 'assistant',
                content: textContent,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                isStreaming: false,
            });
        }
        // Skip 'tool' role messages — already processed above
    }

    return uiMessages;
}

// Multer for file uploads (in-memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
});

export async function startUIServer(port: number, flags: CLIFlags): Promise<void> {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));

    const cwd = process.cwd();
    const config = loadConfig(cwd, flags);

    // Serve React UI from ui/dist
    const uiDistPath = path.resolve(__dirname, '../../ui/dist');
    app.use(express.static(uiDistPath));

    // Session and context
    let session: Session = loadLatestSession(cwd) || createSession(cwd);
    let conversationHistory: Message[] = session.messages;

    const agentsMdContent = loadAgentsMd(cwd);
    const memoryContent = loadMemory(cwd);
    const skillRegistry = loadSkills(cwd);

    // Provider
    let provider: import('../providers/base.js').LLMProvider;
    try {
        provider = createProvider(config.provider);
    } catch (err: any) {
        console.error(chalk.red(`Error creating provider: ${err.message}`));
        process.exit(1);
    }

    // Tools
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

    if (skillRegistry.size > 0) {
        tools.register(createUseSkillTool(skillRegistry));
    }

    let mcpConnections: MCPConnection[] = [];
    if (Object.keys(config.mcpServers).length > 0) {
        try {
            mcpConnections = await connectMCPServers(config.mcpServers, tools, config.verbose);
        } catch (err) {
            console.error(chalk.yellow(`MCP init error: ${err}`));
        }
    }

    // ─── SSE Management ───

    let clients: express.Response[] = [];
    let currentAbortController: AbortController | null = null;
    let lastToolCallId: string | null = null;
    let pendingConfirmation: { resolve: (v: boolean | string) => void } | null = null;

    const sendEvent = (event: string, data: any) => {
        const payload = JSON.stringify({ type: event, ...data });
        clients.forEach(client => {
            client.write(`event: message\ndata: ${payload}\n\n`);
        });
    };

    // SSE Stream endpoint
    app.get('/api/chat/stream', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        clients.push(res);
        req.on('close', () => {
            clients = clients.filter(c => c !== res);
        });
    });

    // ─── Stop endpoint ───

    app.post('/api/chat/stop', (_req, res) => {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            sendEvent('done', {});
        }
        res.json({ status: 'stopped' });
    });

    // ─── Confirm endpoint ───

    app.post('/api/chat/confirm', (req, res) => {
        const { response } = req.body;
        if (pendingConfirmation) {
            if (response === 'allow') {
                pendingConfirmation.resolve(true);
            } else if (response === 'deny') {
                pendingConfirmation.resolve(false);
            } else if (typeof response === 'string') {
                pendingConfirmation.resolve(response);
            } else {
                pendingConfirmation.resolve(false);
            }
            pendingConfirmation = null;
        }
        res.json({ status: 'ok' });
    });

    // ─── Status endpoint ───

    app.get('/api/status', (_req, res) => {
        res.json({
            model: config.provider.model,
            provider: config.provider.type,
            autonomy: config.autonomy,
            messageCount: conversationHistory.length,
            cwd,
        });
    });

    // ─── Models endpoint ───

    app.get('/api/models', (_req, res) => {
        const models = listModels();
        res.json({
            models: models.map(m => ({
                name: m.name,
                provider: m.provider,
                model: m.model,
                baseUrl: m.baseUrl,
                maxTokens: m.maxTokens,
                apiKeyMasked: (m as any).apiKeyMasked,
                isDefault: m.isDefault,
            })),
            current: config.provider.model,
        });
    });

    app.post('/api/models', (req, res) => {
        try {
            const { name, provider: prov, model: mod, baseUrl, apiKey, maxTokens, isDefault } = req.body;
            if (!name || !prov || !mod || !baseUrl) {
                return res.status(400).json({ error: 'name, provider, model, and baseUrl are required' });
            }
            addModel({
                name,
                provider: prov,
                model: mod,
                baseUrl,
                apiKey: apiKey || undefined,
                maxTokens: maxTokens || 16384,
                isDefault: !!isDefault,
            });
            res.json({ status: 'ok' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/models/:name', (req, res) => {
        const removed = removeModel(req.params.name);
        if (removed) {
            res.json({ status: 'deleted' });
        } else {
            res.status(404).json({ error: 'Model not found' });
        }
    });

    app.post('/api/models/:name/default', (req, res) => {
        const set = setDefaultModel(req.params.name);
        if (set) {
            res.json({ status: 'ok' });
        } else {
            res.status(404).json({ error: 'Model not found' });
        }
    });

    app.get('/api/provider-presets', (_req, res) => {
        res.json(PROVIDER_PRESETS);
    });

    // ─── MCP endpoints ───

    app.get('/api/mcp', (_req, res) => {
        const servers = listMcpServers();
        res.json({ servers });
    });

    app.post('/api/mcp/:name', (req, res) => {
        try {
            const name = req.params.name;
            const { command, args, url, transport } = req.body;
            if (command) {
                addMcpServer(name, { command, args: args || [] });
            } else if (url) {
                addMcpServer(name, { url, transport: transport || 'http' });
            } else {
                return res.status(400).json({ error: 'Provide command (stdio) or url (remote)' });
            }
            res.json({ status: 'ok' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/mcp/:name', (req, res) => {
        const removed = removeMcpServer(req.params.name);
        if (removed) {
            res.json({ status: 'deleted' });
        } else {
            res.status(404).json({ error: 'Server not found' });
        }
    });

    // ─── Skills endpoint ───

    app.get('/api/skills', (_req, res) => {
        const skills = skillRegistry.list().map(s => ({
            name: s.name,
            description: s.description,
        }));
        res.json({ skills });
    });

    // ─── Settings endpoint ───

    app.post('/api/settings', (req, res) => {
        const { model, autonomy } = req.body;

        if (model) {
            const m = getModel(model);
            if (m) {
                config.provider = {
                    ...config.provider,
                    model: m.model,
                    baseUrl: m.baseUrl,
                    apiKey: m.apiKey,
                    maxTokens: m.maxTokens,
                };
                provider = createProvider(config.provider);
            }
        }

        if (autonomy && ['low', 'medium', 'high'].includes(autonomy)) {
            config.autonomy = autonomy as 'low' | 'medium' | 'high';
        }

        res.json({
            status: 'ok',
            model: config.provider.model,
            provider: config.provider.type,
            autonomy: config.autonomy,
        });
    });

    // ─── Session endpoints ───

    app.get('/api/sessions', (_req, res) => {
        const sessions = listSessions(50);
        res.json({
            sessions: sessions.map(s => ({
                id: s.id,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                cwd: s.cwd,
                messageCount: s.messages.length,
                preview: getSessionPreview(s),
            })),
            currentSessionId: session.id,
        });
    });

    app.post('/api/sessions/new', (_req, res) => {
        // Save current session before creating new one
        if (conversationHistory.length > 0) {
            saveSession(session);
        }
        session = createSession(cwd);
        conversationHistory = [];
        res.json({ sessionId: session.id });
    });

    app.post('/api/sessions/:id/load', (req, res) => {
        const loaded = loadSession(req.params.id);
        if (!loaded) {
            return res.status(404).json({ error: 'Session not found' });
        }
        // Save current session before switching
        if (conversationHistory.length > 0) {
            saveSession(session);
        }
        session = loaded;
        conversationHistory = session.messages;
        res.json({ sessionId: session.id, messageCount: conversationHistory.length });
    });

    app.delete('/api/sessions/:id', (req, res) => {
        const id = req.params.id;
        if (id === session.id) {
            return res.status(400).json({ error: 'Cannot delete active session' });
        }
        const sessionPath = path.join(homedir(), '.deepa', 'sessions', `${id}.json`);
        if (fileExists(sessionPath)) {
            unlinkSync(sessionPath);
            res.json({ status: 'deleted' });
        } else {
            res.status(404).json({ error: 'Session not found' });
        }
    });

    // ─── Chat history endpoint (for restoring on page load) ───

    app.get('/api/chat/history', (_req, res) => {
        // Convert internal messages to a format the UI can render
        const uiMessages = convertMessagesToUI(conversationHistory);
        res.json({ messages: uiMessages, sessionId: session.id });
    });

    // ─── Chat endpoint (with file uploads) ───

    app.post('/api/chat', upload.array('files', 5), async (req, res) => {
        const message = req.body?.message;
        const files = (req.files as Express.Multer.File[]) || [];

        if (!message && files.length === 0) {
            return res.status(400).json({ error: 'Message or files required' });
        }

        // Acknowledge immediately
        res.status(202).json({ status: 'Processing started' });

        sendEvent('start', { id: Date.now().toString() });

        // Build user input — multimodal if files present
        let userInput: string | MessageContent[];
        if (files.length > 0) {
            const content: MessageContent[] = [];
            if (message) {
                content.push({ type: 'text', text: message });
            }
            for (const file of files) {
                if (file.mimetype.startsWith('image/')) {
                    content.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            mediaType: file.mimetype as any,
                            data: file.buffer.toString('base64'),
                        },
                    } as any);
                } else {
                    // Text file — include as text content
                    const fileContent = file.buffer.toString('utf-8');
                    content.push({
                        type: 'text',
                        text: `\n--- ${file.originalname} ---\n${fileContent}`,
                    });
                }
            }
            userInput = content.length === 1 && content[0].type === 'text'
                ? (content[0] as any).text
                : content;
        } else {
            userInput = message;
        }

        // Create abort controller for this request
        currentAbortController = new AbortController();

        try {
            // Spread config but keep reference to config.autonomy live via loop.ts getter
            const updatedConfig = {
                ...config,
                mode: 'exec' as const,
                get autonomy() { return config.autonomy; },
            };

            const messages = await runAgentLoop(userInput, conversationHistory, {
                provider,
                tools,
                config: updatedConfig,
                cwd,
                agentsMdContent,
                memoryContent,
                skillDescriptions: skillRegistry.getDescriptions(),
                signal: currentAbortController.signal,
                confirmAction: async (description: string) => {
                    return new Promise<boolean | string>((resolve) => {
                        pendingConfirmation = { resolve };
                        sendEvent('confirm_request', { description });
                    });
                },
                onText: (text) => {
                    sendEvent('text', { content: text });
                },
                onToolCall: (name, args) => {
                    const callId = Date.now().toString() + Math.random().toString(36).slice(2, 6);
                    lastToolCallId = callId;
                    sendEvent('tool_call', { name, args, callId });
                },
                onToolResult: (name, result, isError) => {
                    sendEvent('tool_result', { name, result, isError, callId: lastToolCallId });
                    lastToolCallId = null;
                },
                onTokenUsage: (p, c) => {
                    recordTokenUsage({
                        model: config.provider.model,
                        provider: config.provider.type,
                        promptTokens: p,
                        completionTokens: c,
                        sessionId: session.id,
                    });
                },
            });

            conversationHistory = messages;
            session.messages = messages;
            saveSession(session);

            sendEvent('done', {});
        } catch (err: any) {
            if (currentAbortController?.signal.aborted) {
                // Already sent 'done' from stop handler
            } else {
                console.error(chalk.red(`Chat error: ${err.message}`));
                sendEvent('error', { error: err.message });
            }
        } finally {
            currentAbortController = null;
        }
    });

    // SPA catch-all
    app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api/')) {
            res.sendFile(path.resolve(uiDistPath, 'index.html'));
        } else {
            next();
        }
    });

    return new Promise((resolve) => {
        app.listen(port, () => {
            console.log(chalk.green(`\n✨ Deepa UI is running on ${chalk.bold(`http://localhost:${port}`)}\n`));
            resolve();
        });
    });
}
