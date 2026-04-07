/**
 * Tests for MCP client improvements:
 *  1. Tool name normalization
 *  2. Session expiry detection
 *  3. Image/binary content extraction
 *  4. Zod config validation
 *  5. Description truncation
 *  6. enabled: false filtering
 *  7. Parallel connections (one failure doesn't block others)
 *  8. Resources & prompts registration
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    normalizeMcpName,
    isSessionExpiredError,
    extractMcpContent,
    connectMCPServers,
    MAX_DESCRIPTION_LENGTH,
} from '../../src/mcp/client.js';
import {
    MCPServerConfigSchema,
    validateMcpServerConfig,
} from '../../src/store/mcp.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// ─── Shared mock via vi.hoisted ───────────────────────────────────────────────
// vi.hoisted runs before module transforms so we can reference `mockClient`
// inside vi.mock factories.

const mockClient = vi.hoisted(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    listResources: vi.fn().mockResolvedValue({ resources: [] }),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    readResource: vi.fn().mockResolvedValue({ contents: [{ type: 'text', text: 'resource' }] }),
    getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: vi.fn(function () { return mockClient; }),
}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: vi.fn(function () { return {}; }),
}));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
    SSEClientTransport: vi.fn(function () { return {}; }),
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
    StreamableHTTPClientTransport: vi.fn(function () { return {}; }),
}));
vi.mock('eventsource', () => ({ EventSource: function () {} }));

// ─── Reset defaults before each test ─────────────────────────────────────────

beforeEach(() => {
    // Reset call history without clearing implementations
    vi.mocked(Client).mockClear();
    // Reset method call history + restore defaults
    mockClient.connect.mockReset().mockResolvedValue(undefined);
    mockClient.close.mockReset().mockResolvedValue(undefined);
    mockClient.listTools.mockReset().mockResolvedValue({ tools: [] });
    mockClient.listResources.mockReset().mockResolvedValue({ resources: [] });
    mockClient.listPrompts.mockReset().mockResolvedValue({ prompts: [] });
    mockClient.callTool.mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    mockClient.readResource.mockReset().mockResolvedValue({ contents: [{ type: 'text', text: 'resource' }] });
    mockClient.getPrompt.mockReset().mockResolvedValue({ messages: [] });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRegistry() { return new ToolRegistry(); }

function makeContext() {
    return {
        cwd: '/tmp',
        autonomy: 'high' as const,
        confirmAction: async () => true as const,
        log: () => {},
        readFileState: new Map(),
        messages: [],
    };
}

// ─── 1. Tool name normalization ───────────────────────────────────────────────

describe('normalizeMcpName', () => {
    it('passes safe names through unchanged', () => {
        expect(normalizeMcpName('my_server')).toBe('my_server');
        expect(normalizeMcpName('server-1')).toBe('server-1');
        expect(normalizeMcpName('ABC123')).toBe('ABC123');
    });

    it('replaces dots, spaces, and slashes with underscores', () => {
        expect(normalizeMcpName('my.server')).toBe('my_server');
        expect(normalizeMcpName('my server')).toBe('my_server');
        expect(normalizeMcpName('a/b/c')).toBe('a_b_c');
    });

    it('truncates names longer than 64 chars', () => {
        const long = 'a'.repeat(100);
        expect(normalizeMcpName(long)).toHaveLength(64);
    });

    it('handles @ and ! characters', () => {
        expect(normalizeMcpName('server@v2.0!')).toBe('server_v2_0_');
    });
});

// ─── 2. Session expiry detection ─────────────────────────────────────────────

describe('isSessionExpiredError', () => {
    it('detects error with code -32001', () => {
        const err = Object.assign(new Error('x'), { code: -32001 });
        expect(isSessionExpiredError(err)).toBe(true);
    });

    it('detects error message containing -32001', () => {
        expect(isSessionExpiredError(new Error('error -32001 from server'))).toBe(true);
    });

    it('detects "session" + "expir" in message', () => {
        expect(isSessionExpiredError(new Error('Session has expired'))).toBe(true);
    });

    it('returns false for unrelated errors', () => {
        expect(isSessionExpiredError(new Error('connection refused'))).toBe(false);
        expect(isSessionExpiredError(new Error('timeout'))).toBe(false);
        expect(isSessionExpiredError(null)).toBe(false);
        expect(isSessionExpiredError('string error')).toBe(false);
    });
});

// ─── 3. Image/binary content extraction ──────────────────────────────────────

describe('extractMcpContent', () => {
    it('joins multiple text items with newline', () => {
        const result = extractMcpContent([
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' },
        ]);
        expect(result).toBe('hello\nworld');
    });

    it('saves image to disk and returns path reference — not raw base64', () => {
        // 1×1 transparent PNG
        const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const result = extractMcpContent([
            { type: 'image', data: tinyPng, mimeType: 'image/png' },
        ]);
        expect(result).toMatch(/\[Image saved:/);
        expect(result).toMatch(/\.png/);
        expect(result).not.toContain(tinyPng); // raw base64 must NOT appear
    });

    it('JSON-stringifies unknown content types', () => {
        const result = extractMcpContent([{ type: 'binary', blob: 'abc' }]);
        expect(result).toContain('"type":"binary"');
    });

    it('handles non-array input gracefully', () => {
        const result = extractMcpContent({ some: 'object' });
        expect(result).toContain('some');
    });
});

// ─── 4. Zod config validation ─────────────────────────────────────────────────

describe('MCPServerConfigSchema', () => {
    it('accepts a valid stdio config', () => {
        const r = MCPServerConfigSchema.safeParse({ command: 'npx', args: ['-y', 'server'] });
        expect(r.success).toBe(true);
    });

    it('accepts a valid URL config', () => {
        const r = MCPServerConfigSchema.safeParse({ url: 'https://example.com/mcp' });
        expect(r.success).toBe(true);
    });

    it('accepts env, transport, and enabled fields', () => {
        const r = MCPServerConfigSchema.safeParse({
            url: 'https://example.com/mcp',
            transport: 'sse',
            env: { TOKEN: 'abc' },
            enabled: false,
        });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.enabled).toBe(false);
            expect(r.data.transport).toBe('sse');
        }
    });

    it('rejects config missing both command and url', () => {
        const r = MCPServerConfigSchema.safeParse({ args: ['--foo'] });
        expect(r.success).toBe(false);
    });

    it('rejects an invalid URL', () => {
        const r = MCPServerConfigSchema.safeParse({ url: 'not-a-url' });
        expect(r.success).toBe(false);
    });

    it('rejects unknown transport value', () => {
        const r = MCPServerConfigSchema.safeParse({ command: 'foo', transport: 'websocket' });
        expect(r.success).toBe(false);
    });

    it('validateMcpServerConfig convenience wrapper works', () => {
        expect(validateMcpServerConfig({ command: 'foo' }).success).toBe(true);
        expect(validateMcpServerConfig({}).success).toBe(false);
    });
});

// ─── 5. Description truncation ────────────────────────────────────────────────

describe('description truncation', () => {
    it('caps tool description at MAX_DESCRIPTION_LENGTH chars', async () => {
        const longDesc = 'x'.repeat(MAX_DESCRIPTION_LENGTH + 500);
        mockClient.listTools.mockResolvedValue({
            tools: [{ name: 'big_tool', description: longDesc, inputSchema: { type: 'object', properties: {} } }],
        });

        const registry = makeRegistry();
        await connectMCPServers({ myserver: { command: 'echo' } }, registry);

        const tool = registry.get('mcp_myserver_big_tool');
        expect(tool).toBeDefined();
        const rawDescPart = tool!.description.replace('[MCP: myserver] ', '');
        expect(rawDescPart.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    });
});

// ─── 6. enabled: false filtering ─────────────────────────────────────────────

describe('enabled/disabled server filtering', () => {
    it('skips servers with enabled: false', async () => {
        const registry = makeRegistry();
        const connections = await connectMCPServers({
            active_server: { command: 'echo', enabled: true },
            disabled_server: { command: 'echo', enabled: false },
        }, registry);

        expect(connections).toHaveLength(1);
        expect(connections[0].name).toBe('active_server');
        // Client constructor only called once (disabled server is skipped)
        expect(vi.mocked(Client)).toHaveBeenCalledTimes(1);
    });

    it('includes servers without an explicit enabled field (default on)', async () => {
        const registry = makeRegistry();
        const connections = await connectMCPServers({ implicit: { command: 'echo' } }, registry);
        expect(connections).toHaveLength(1);
    });
});

// ─── 7. Parallel connections ──────────────────────────────────────────────────

describe('parallel connections', () => {
    it('continues when one server fails to connect', async () => {
        // First call to connect throws; second succeeds
        mockClient.connect
            .mockRejectedValueOnce(new Error('connection refused'))
            .mockResolvedValue(undefined);

        const registry = makeRegistry();
        const connections = await connectMCPServers({
            bad_server: { command: 'bad' },
            good_server: { command: 'good' },
        }, registry);

        expect(connections).toHaveLength(1);
        expect(connections[0].name).toBe('good_server');
    });
});

// ─── 8. Resources & prompts ───────────────────────────────────────────────────

describe('resources and prompts registration', () => {
    it('registers list_resources and read_resource tools when server exposes resources', async () => {
        mockClient.listResources.mockResolvedValue({
            resources: [{ uri: 'file:///readme.md', name: 'README' }],
        });

        const registry = makeRegistry();
        await connectMCPServers({ docs: { command: 'docs-server' } }, registry);

        expect(registry.get('mcp_docs_list_resources')).toBeDefined();
        expect(registry.get('mcp_docs_read_resource')).toBeDefined();
    });

    it('read_resource tool executes and returns content', async () => {
        mockClient.listResources.mockResolvedValue({
            resources: [{ uri: 'file:///test.md', name: 'test' }],
        });
        mockClient.readResource.mockResolvedValue({
            contents: [{ type: 'text', text: 'hello from resource' }],
        });

        const registry = makeRegistry();
        await connectMCPServers({ res: { command: 'res-server' } }, registry);

        const result = await registry.execute('mcp_res_read_resource', { uri: 'file:///test.md' }, makeContext());
        expect(result.content).toBe('hello from resource');
    });

    it('registers prompt tools when server exposes prompts', async () => {
        mockClient.listPrompts.mockResolvedValue({
            prompts: [{ name: 'summarize', description: 'Summarize text' }],
        });

        const registry = makeRegistry();
        await connectMCPServers({ ai: { command: 'ai-server' } }, registry);

        const promptTool = registry.get('mcp_ai_prompt_summarize');
        expect(promptTool).toBeDefined();
        expect(promptTool!.description).toContain('Summarize text');
    });

    it('prompt tool executes and returns rendered text', async () => {
        mockClient.listPrompts.mockResolvedValue({
            prompts: [{ name: 'greet', description: 'Greeting' }],
        });
        mockClient.getPrompt.mockResolvedValue({
            messages: [{ content: { text: 'Hello, world!' } }],
        });

        const registry = makeRegistry();
        await connectMCPServers({ ai: { command: 'ai-server' } }, registry);

        const result = await registry.execute('mcp_ai_prompt_greet', { name: 'world' }, makeContext());
        expect(result.content).toBe('Hello, world!');
    });

    it('silently skips resources/prompts when server does not support them', async () => {
        mockClient.listResources.mockRejectedValue(new Error('Method not found'));
        mockClient.listPrompts.mockRejectedValue(new Error('Method not found'));

        const registry = makeRegistry();
        await expect(
            connectMCPServers({ plain: { command: 'plain-server' } }, registry)
        ).resolves.toHaveLength(1);
    });
});

// ─── 9. Tool name normalization in registered names ───────────────────────────

describe('server/tool name normalization in registered tool names', () => {
    it('normalizes dots in server name to underscores', async () => {
        mockClient.listTools.mockResolvedValue({
            tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object', properties: {} } }],
        });

        const registry = makeRegistry();
        await connectMCPServers({ 'my.server.v2': { command: 'server' } }, registry);

        expect(registry.get('mcp_my_server_v2_search')).toBeDefined();
        expect(registry.get('mcp_my.server.v2_search')).toBeUndefined();
    });

    it('normalizes special chars in tool name', async () => {
        mockClient.listTools.mockResolvedValue({
            tools: [{ name: 'get/data', description: 'Get data', inputSchema: { type: 'object', properties: {} } }],
        });

        const registry = makeRegistry();
        await connectMCPServers({ srv: { command: 'server' } }, registry);

        expect(registry.get('mcp_srv_get_data')).toBeDefined();
    });
});
