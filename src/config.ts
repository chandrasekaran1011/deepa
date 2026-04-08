// ─── Configuration system ───
// Loads config from: ~/.deepa/models.json (encrypted) → project .deepa.json → CLI flags
// No .env files — all credentials managed via `deepa model add`

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { getDefaultModel, getModel, type StoredModel } from './store/models.js';
import { getAllMcpServers } from './store/mcp.js';
import type { DeepaConfig, ProviderConfig, AutonomyLevel, AgentMode, MCPServerConfig } from './types.js';

// ────────────────── Schema ──────────────────

const ProjectConfigSchema = z.object({
    provider: z.object({
        type: z.enum(['openai', 'anthropic', 'azure', 'ollama', 'lmstudio', 'custom']).optional(),
        model: z.string().optional(),
        baseUrl: z.string().optional(),
        maxTokens: z.number().optional(),
    }).optional(),
    autonomy: z.enum(['low', 'medium', 'high']).optional(),
    mode: z.enum(['plan', 'exec']).optional(),
    verbose: z.boolean().optional(),
}).passthrough();

// ────────────────── Helpers ──────────────────

function loadProjectConfig(cwd: string): Record<string, unknown> {
    const path = join(cwd, '.deepa.json');
    if (!existsSync(path)) return {};
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
        return {};
    }
}

function storedModelToProvider(model: StoredModel): ProviderConfig {
    // Map provider types to internal provider types
    let type: ProviderConfig['type'];
    if (model.provider === 'ollama' || model.provider === 'lmstudio' || model.provider === 'custom') {
        type = 'local';
    } else if (model.provider === 'azure') {
        // Azure OpenAI uses the same OpenAI provider with max_completion_tokens
        type = 'openai';
    } else {
        type = model.provider as 'openai' | 'anthropic';
    }

    return {
        type,
        apiKey: model.apiKey,
        baseUrl: model.baseUrl,
        model: model.model,
        maxTokens: model.maxTokens,
        // Azure always needs max_completion_tokens
        useMaxCompletionTokens: model.useMaxCompletionTokens || model.provider === 'azure',
        reasoningEffort: model.reasoningEffort,
        thinkingBudget: model.thinkingBudget,
    };
}

// ────────────────── CLI Flags ──────────────────

export interface CLIFlags {
    provider?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    autonomy?: string;
    mode?: string;
    verbose?: boolean;
    useModel?: string;  // --use-model flag to pick a named stored model
}

// ────────────────── Main Loader ──────────────────

export function loadConfig(cwd: string = process.cwd(), flags: CLIFlags = {}): DeepaConfig {
    // Step 1: Start with defaults
    let providerConfig: ProviderConfig = {
        type: 'openai',
        model: 'gpt-4o',
        maxTokens: 16384,
    };
    let autonomy: AutonomyLevel = 'medium';
    let mode: AgentMode = 'exec'; // Default to DeepAgent mode
    let verbose = false;

    // Step 2: Load from stored model (encrypted ~/.deepa/models.json)
    const storedModel = flags.useModel
        ? getModel(flags.useModel)
        : getDefaultModel();

    if (storedModel) {
        providerConfig = storedModelToProvider(storedModel);
    }

    // Step 3: Project config (.deepa.json)
    const projectConfig = loadProjectConfig(cwd);
    const parsed = ProjectConfigSchema.safeParse(projectConfig);
    if (parsed.success && parsed.data.provider) {
        if (parsed.data.provider.type) {
            const pt = parsed.data.provider.type;
            if (pt === 'ollama' || pt === 'lmstudio' || pt === 'custom') {
                providerConfig.type = 'local';
            } else if (pt === 'azure') {
                providerConfig.type = 'openai';
                providerConfig.useMaxCompletionTokens = true;
            } else {
                providerConfig.type = pt as 'openai' | 'anthropic';
            }
        }
        if (parsed.data.provider.model) providerConfig.model = parsed.data.provider.model;
        if (parsed.data.provider.baseUrl) providerConfig.baseUrl = parsed.data.provider.baseUrl;
        if (parsed.data.provider.maxTokens) providerConfig.maxTokens = parsed.data.provider.maxTokens;
    }
    if (parsed.success) {
        if (parsed.data.autonomy) autonomy = parsed.data.autonomy;
        if (parsed.data.mode) mode = parsed.data.mode as AgentMode;
        if (parsed.data.verbose !== undefined) verbose = parsed.data.verbose;
    }

    // Step 4: CLI flags (highest priority)
    if (flags.model) providerConfig.model = flags.model;
    if (flags.baseUrl) providerConfig.baseUrl = flags.baseUrl;
    if (flags.apiKey) providerConfig.apiKey = flags.apiKey;
    if (flags.provider) {
        const p = flags.provider;
        if (p === 'ollama' || p === 'lmstudio' || p === 'custom') {
            providerConfig.type = 'local';
        } else if (p === 'azure') {
            providerConfig.type = 'openai';
            providerConfig.useMaxCompletionTokens = true;
        } else if (p === 'openai' || p === 'anthropic') {
            providerConfig.type = p;
        }
    }
    if (flags.autonomy && ['low', 'medium', 'high'].includes(flags.autonomy)) {
        autonomy = flags.autonomy as AutonomyLevel;
    }
    if (flags.mode) mode = flags.mode as AgentMode;
    if (flags.verbose !== undefined) verbose = flags.verbose;

    // Step 5: Load MCP servers from global + project
    const mcpServers = getAllMcpServers(cwd);

    return {
        provider: providerConfig,
        autonomy,
        mode,
        mcpServers,
        verbose,
    };
}
