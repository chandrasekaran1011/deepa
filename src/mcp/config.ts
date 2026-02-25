// ─── MCP configuration helpers ───

import type { MCPServerConfig } from '../types.js';

/**
 * Merge MCP server configs from multiple sources.
 * Later sources override earlier ones for the same server name.
 */
export function mergeMCPConfigs(
    ...configs: Array<Record<string, MCPServerConfig>>
): Record<string, MCPServerConfig> {
    const merged: Record<string, MCPServerConfig> = {};
    for (const config of configs) {
        Object.assign(merged, config);
    }
    return merged;
}

/**
 * Validate an MCP server configuration.
 */
export function validateMCPConfig(name: string, config: MCPServerConfig): string[] {
    const errors: string[] = [];

    if (!config.command && !config.url) {
        errors.push(`MCP server "${name}": must specify either "command" (stdio) or "url" (HTTP)`);
    }

    if (config.command && config.url) {
        errors.push(`MCP server "${name}": cannot specify both "command" and "url"`);
    }

    return errors;
}
