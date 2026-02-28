// ─── Provider registry / factory ───

import type { LLMProvider } from './base.js';
import type { ProviderConfig } from '../types.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';

export function createProvider(config: ProviderConfig): LLMProvider {
    switch (config.type) {
        case 'anthropic':
            if (!config.apiKey) {
                throw new Error('Anthropic API key is required. Set ANTHROPIC_API_KEY or configure in ~/.deepa/config.json');
            }
            return new AnthropicProvider({
                apiKey: config.apiKey,
                baseUrl: config.baseUrl,
                model: config.model || 'claude-sonnet-4-20250514',
                maxTokens: config.maxTokens || 16384,
            });

        case 'openai':
            return new OpenAIProvider({
                apiKey: config.apiKey || '',
                baseUrl: config.baseUrl || 'https://api.openai.com/v1',
                model: config.model || 'gpt-4o',
                maxTokens: config.maxTokens || 16384,
            });

        case 'local':
        default:
            return new OpenAIProvider({
                apiKey: config.apiKey || '',
                baseUrl: config.baseUrl || 'http://localhost:1234/v1',
                model: config.model || 'local-model',
                maxTokens: config.maxTokens, // Do not default for local; let Llama.cpp handle context natively
                isLocal: true,
            });
    }
}

export { type LLMProvider } from './base.js';
