// ─── Plugin loader ───

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface PluginManifest {
    name: string;
    description: string;
    version: string;
    tools?: string[];
    mcpServers?: Record<string, { command: string; args?: string[] }>;
    commands?: string[];
}

export interface LoadedPlugin {
    manifest: PluginManifest;
    path: string;
}

/**
 * Discover and load plugins from global and project plugin directories.
 */
export function loadPlugins(cwd: string): LoadedPlugin[] {
    const plugins: LoadedPlugin[] = [];
    const dirs = [
        join(homedir(), '.deepa', 'plugins'),
        join(cwd, '.deepa', 'plugins'),
    ];

    for (const dir of dirs) {
        if (!existsSync(dir)) continue;

        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const manifestPath = join(dir, entry.name, 'plugin.json');
            if (!existsSync(manifestPath)) continue;

            try {
                const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest;
                plugins.push({ manifest, path: join(dir, entry.name) });
            } catch {
                // Skip malformed plugins
            }
        }
    }

    return plugins;
}
