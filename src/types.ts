// ─── Shared types used across the entire deepa-cli agent ───

// ────────────────── LLM Messages ──────────────────

export interface TextContent {
    type: 'text';
    text: string;
}

export interface ToolCallContent {
    type: 'tool_call';
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ToolResultContent {
    type: 'tool_result';
    toolCallId: string;
    content: string;
    isError?: boolean;
}

export interface ImageContent {
    type: 'image';
    source: {
        type: 'base64';
        mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
        data: string;
    };
}

export type MessageContent = TextContent | ImageContent | ToolCallContent | ToolResultContent;

export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool' | 'info';
    content: string | MessageContent[];
}

// ────────────────── Streaming ──────────────────

export interface StreamChunkText {
    type: 'text';
    text: string;
}

export interface StreamChunkToolCall {
    type: 'tool_call';
    id: string;
    name: string;
    arguments: string; // partial JSON accumulator
}

export interface StreamChunkError {
    type: 'error';
    error: string;
}

export interface StreamChunkDone {
    type: 'done';
    usage?: { promptTokens: number; completionTokens: number };
}

export type StreamChunk =
    | StreamChunkText
    | StreamChunkToolCall
    | StreamChunkError
    | StreamChunkDone;

// ────────────────── Tools ──────────────────

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolResult {
    content: string;
    isError?: boolean;
}

export interface ToolContext {
    cwd: string;
    autonomy: AutonomyLevel;
    confirmAction: (description: string) => Promise<boolean | string>;
    log: (message: string) => void;
    readFileState: Map<string, number>; // Maps explicit absolute path -> timestamp
    askSubagent?: (prompt: string, context: string) => Promise<string>;
    messages: Message[];
    /** Current spawn depth — 0 for the root agent, incremented for each nested spawn */
    spawnDepth?: number;
    /** Abort signal propagated from the parent — subagents should respect this */
    signal?: AbortSignal;
    /** Hooks config — loaded once per session, passed through context */
    hooksConfig?: import('./hooks/index.js').HooksConfig;
    /** Denial counter — tracks consecutive user denials for autonomy downgrade */
    denialTracker?: DenialTracker;
}

export interface DenialTracker {
    count: number;
    onDenial: () => void;
}

// ────────────────── Config ──────────────────

export type ProviderType = 'openai' | 'anthropic' | 'local';
export type AutonomyLevel = 'low' | 'medium' | 'high';
export type SafetyLevel = 'low' | 'medium' | 'high' | 'very-high';
export type AgentMode = 'chat' | 'plan' | 'exec';

export interface ProviderConfig {
    type: ProviderType;
    apiKey?: string;
    baseUrl?: string;
    model: string;
    maxTokens: number;
    useMaxCompletionTokens?: boolean;
    apiVersion?: string;
    reasoningEffort?: 'low' | 'medium' | 'high';
    thinkingBudget?: number;
}

export interface MCPServerConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string; // for HTTP transport
    transport?: 'stdio' | 'sse' | 'http'; // explicitly specify transport
    enabled?: boolean; // false = skip this server at startup (default: true)
}

export interface DeepaConfig {
    provider: ProviderConfig;
    autonomy: AutonomyLevel;
    mode: AgentMode;
    mcpServers: Record<string, MCPServerConfig>;
    verbose: boolean;
}
