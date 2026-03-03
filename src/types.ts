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
    role: 'system' | 'user' | 'assistant' | 'tool';
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
    apiVersion?: string;
}

export interface MCPServerConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string; // for HTTP transport
    transport?: 'stdio' | 'sse' | 'http'; // explicitly specify transport
}

export interface DeepaConfig {
    provider: ProviderConfig;
    autonomy: AutonomyLevel;
    mode: AgentMode;
    mcpServers: Record<string, MCPServerConfig>;
    verbose: boolean;
}
