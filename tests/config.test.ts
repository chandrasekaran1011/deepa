import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

const TEST_DIR = join(tmpdir(), 'deepa-cli-config-test-' + Date.now());

// We need to mock the store modules since they access ~/.deepa
vi.mock('../src/store/models.js', () => ({
    getDefaultModel: vi.fn(() => undefined),
    getModel: vi.fn(() => undefined),
}));

vi.mock('../src/store/mcp.js', () => ({
    getAllMcpServers: vi.fn(() => ({})),
}));

// Must import after mocks are set up
import { loadConfig } from '../src/config.js';

describe('Config System', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('returns default config when no files exist', () => {
        const config = loadConfig(TEST_DIR);
        expect(config.provider.type).toBe('openai');
        expect(config.provider.model).toBe('gpt-4o');
        expect(config.autonomy).toBe('medium');
        expect(config.mode).toBe('exec');
        expect(config.verbose).toBe(false);
    });

    it('reads project .deepa.json', () => {
        writeFileSync(
            join(TEST_DIR, '.deepa.json'),
            JSON.stringify({
                provider: { type: 'anthropic', model: 'claude-sonnet-4-20250514' },
                autonomy: 'high',
            }),
        );

        const config = loadConfig(TEST_DIR);
        expect(config.provider.type).toBe('anthropic');
        expect(config.provider.model).toBe('claude-sonnet-4-20250514');
        expect(config.autonomy).toBe('high');
    });

    it('CLI flags override file config', () => {
        writeFileSync(
            join(TEST_DIR, '.deepa.json'),
            JSON.stringify({ provider: { model: 'gpt-4' } }),
        );

        const config = loadConfig(TEST_DIR, { model: 'gpt-4o-mini' });
        expect(config.provider.model).toBe('gpt-4o-mini');
    });

    it('handles malformed config files gracefully', () => {
        writeFileSync(join(TEST_DIR, '.deepa.json'), 'not json {{{');
        const config = loadConfig(TEST_DIR);
        expect(config.provider.type).toBe('openai');
    });

    it('maps ollama provider to local type', () => {
        const config = loadConfig(TEST_DIR, { provider: 'ollama' });
        expect(config.provider.type).toBe('local');
    });

    it('maps lmstudio provider to local type', () => {
        const config = loadConfig(TEST_DIR, { provider: 'lmstudio' });
        expect(config.provider.type).toBe('local');
    });
});
