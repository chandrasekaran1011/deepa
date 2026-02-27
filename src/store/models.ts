// ─── Encrypted model/provider storage ───
// Stores API keys encrypted in ~/.deepa/models.json
// Uses Node.js built-in crypto with a machine-derived key

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, hostname, userInfo } from 'os';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const DEEPA_DIR = join(homedir(), '.deepa');
const MODELS_FILE = join(DEEPA_DIR, 'models.json');
const ALGORITHM = 'aes-256-gcm';

// ────────────────── Types ──────────────────

export interface StoredModel {
    name: string;           // user-friendly name, e.g. "gpt4", "claude", "local-llama"
    provider: 'openai' | 'anthropic' | 'ollama' | 'lmstudio' | 'custom';
    model: string;          // model identifier, e.g. "gpt-4o", "llama3.2"
    baseUrl: string;        // API endpoint
    apiKey?: string;        // encrypted at rest
    maxTokens: number;
    isDefault?: boolean;
}

interface ModelsStore {
    version: 1;
    models: StoredModel[];
}

// ────────────────── Encryption ──────────────────

function deriveKey(): Buffer {
    // Machine-specific key derived from hostname + username
    // This prevents the file from being usable on other machines
    const seed = `deepa-cli:${hostname()}:${userInfo().username}:v1`;
    return createHash('sha256').update(seed).digest();
}

function encrypt(text: string): string {
    if (!text) return '';
    const key = deriveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(data: string): string {
    if (!data) return '';
    try {
        const [ivHex, authTagHex, encrypted] = data.split(':');
        const key = deriveKey();
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch {
        return '';
    }
}

// ────────────────── Store Operations ──────────────────

function ensureDeepaDir(): void {
    const dirs = [
        DEEPA_DIR,
        join(DEEPA_DIR, 'skills'),
        join(DEEPA_DIR, 'plugins'),
        join(DEEPA_DIR, 'memory'),
        join(DEEPA_DIR, 'memory', 'global'),
        join(DEEPA_DIR, 'sessions'),
    ];
    for (const dir of dirs) {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }
    // Ensure mcp.json exists
    const mcpFile = join(DEEPA_DIR, 'mcp.json');
    if (!existsSync(mcpFile)) {
        writeFileSync(mcpFile, JSON.stringify({ mcpServers: {} }, null, 2), 'utf-8');
    }
}

const MIN_RECOMMENDED_TOKENS = 16384;

function loadStore(): ModelsStore {
    ensureDeepaDir();
    if (!existsSync(MODELS_FILE)) {
        return { version: 1, models: [] };
    }
    try {
        const data = JSON.parse(readFileSync(MODELS_FILE, 'utf-8'));
        const store = data as ModelsStore;

        // Auto-migrate models with low maxTokens (old 4096 default)
        let migrated = false;
        for (const model of store.models) {
            if (model.maxTokens < MIN_RECOMMENDED_TOKENS) {
                model.maxTokens = MIN_RECOMMENDED_TOKENS;
                migrated = true;
            }
        }
        if (migrated) saveStore(store);

        return store;
    } catch {
        return { version: 1, models: [] };
    }
}

function saveStore(store: ModelsStore): void {
    ensureDeepaDir();
    writeFileSync(MODELS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

// ────────────────── Public API ──────────────────

/**
 * Add or update a model configuration.
 */
export function addModel(model: StoredModel): void {
    const store = loadStore();

    // Encrypt the API key before saving
    const toSave = { ...model };
    if (toSave.apiKey) {
        toSave.apiKey = encrypt(toSave.apiKey);
    }

    // If setting as default, unset others
    if (toSave.isDefault) {
        for (const m of store.models) {
            m.isDefault = false;
        }
    }

    // Update existing or add new
    const existingIdx = store.models.findIndex((m) => m.name === model.name);
    if (existingIdx >= 0) {
        store.models[existingIdx] = toSave;
    } else {
        // First model is always default
        if (store.models.length === 0) {
            toSave.isDefault = true;
        }
        store.models.push(toSave);
    }

    saveStore(store);
}

/**
 * Remove a model by name.
 */
export function removeModel(name: string): boolean {
    const store = loadStore();
    const idx = store.models.findIndex((m) => m.name === name);
    if (idx < 0) return false;

    const wasDefault = store.models[idx].isDefault;
    store.models.splice(idx, 1);

    // If we removed the default, set the first remaining as default
    if (wasDefault && store.models.length > 0) {
        store.models[0].isDefault = true;
    }

    saveStore(store);
    return true;
}

/**
 * Get a model by name (with decrypted API key).
 */
export function getModel(name: string): StoredModel | undefined {
    const store = loadStore();
    const model = store.models.find((m) => m.name === name);
    if (!model) return undefined;

    return {
        ...model,
        apiKey: model.apiKey ? decrypt(model.apiKey) : undefined,
    };
}

/**
 * Get the default model (with decrypted API key).
 */
export function getDefaultModel(): StoredModel | undefined {
    const store = loadStore();
    const model = store.models.find((m) => m.isDefault) || store.models[0];
    if (!model) return undefined;

    return {
        ...model,
        apiKey: model.apiKey ? decrypt(model.apiKey) : undefined,
    };
}

/**
 * List all models (with keys masked).
 */
export function listModels(): Array<StoredModel & { apiKeyMasked?: string }> {
    const store = loadStore();
    return store.models.map((m) => ({
        ...m,
        apiKey: undefined,
        apiKeyMasked: m.apiKey ? '••••••••' + (decrypt(m.apiKey)?.slice(-4) || '') : undefined,
    }));
}

/**
 * Set a model as default.
 */
export function setDefaultModel(name: string): boolean {
    const store = loadStore();
    const model = store.models.find((m) => m.name === name);
    if (!model) return false;

    for (const m of store.models) {
        m.isDefault = m.name === name;
    }

    saveStore(store);
    return true;
}

// ────────────────── Provider Presets ──────────────────

export const PROVIDER_PRESETS: Record<string, { baseUrl: string; needsKey: boolean; defaultModel: string }> = {
    openai: {
        baseUrl: 'https://api.openai.com/v1',
        needsKey: true,
        defaultModel: 'gpt-4o',
    },
    anthropic: {
        baseUrl: 'https://api.anthropic.com',
        needsKey: true,
        defaultModel: 'claude-sonnet-4-20250514',
    },
    ollama: {
        baseUrl: 'http://localhost:11434/v1',
        needsKey: false,
        defaultModel: 'llama3.2',
    },
    lmstudio: {
        baseUrl: 'http://localhost:1234/v1',
        needsKey: false,
        defaultModel: 'default',
    },
    custom: {
        baseUrl: 'http://localhost:8000/v1',
        needsKey: false,
        defaultModel: 'default',
    },
};
