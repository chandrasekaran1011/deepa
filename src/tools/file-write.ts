// ─── File write tool ───

import { writeFileSync, appendFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { resolvePath } from './resolve-path.js';
import { z } from 'zod';
import type { Tool } from './registry.js';
import type { ToolResult, ToolContext } from '../types.js';

const parameters = z.object({
    path: z.string().nullable().describe('Absolute or relative path to write to'),
    content: z.string().nullable().describe('File content to write'),
    append: z.boolean().optional().nullable().default(false).describe('Append to existing file instead of overwriting. Use for chunked writes of large files.'),
    createDirectories: z.boolean().optional().nullable().default(true).describe('Create parent directories if they don\'t exist'),
});

/** Extensions that cannot be written as plain text — must use scripts to generate */
const BINARY_EXTENSIONS = new Set([
    // Office / documents
    '.pptx', '.xlsx', '.xls', '.pdf', '.docx', '.doc',
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff',
    // Audio / video
    '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac', '.ogg', '.webm',
    // Archives
    '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
    // Executables / libraries
    '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a',
    // Fonts
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

export const fileWriteTool: Tool = {
    name: 'file_write',
    description: 'Write text content to a file (.txt, .md, and source code files). ' +
        'Supports chunked writes: set append=true to append to an existing file. ' +
        'For large files, write the first chunk with append=false, then subsequent chunks with append=true. ' +
        'For binary/rich formats (.pptx, .xlsx, .pdf, .docx, .png, .jpg, .zip, etc.), write a script and run it with shell.',
    parameters,
    safetyLevel: 'cautious',

    async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
        const { path: filePath, content, append, createDirectories } = params as z.infer<typeof parameters>;

        if (!filePath) {
            return { content: 'Error: "path" is required for file_write', isError: true };
        }
        if (!content && content !== '') {
            return { content: 'Error: "content" is required for file_write', isError: true };
        }

        const absPath = resolvePath(filePath, context.cwd);
        const dir = dirname(absPath);

        // Block binary/rich formats — these must be created via scripts
        const ext = absPath.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
        if (BINARY_EXTENSIONS.has(ext)) {
            return {
                content: `Error: Cannot write binary/rich format "${ext}" files using file_write. ` +
                    `You MUST write a Node.js or Python script to generate the file programmatically, ` +
                    `then run that script with the shell tool.`,
                isError: true,
            };
        }

        if (createDirectories && !existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        // ─── Append mode (chunked writes) ───
        if (append) {
            if (!existsSync(absPath)) {
                return {
                    content: `Error: Cannot append — file does not exist: ${absPath}. Use append=false for the first chunk.`,
                    isError: true,
                };
            }
            appendFileSync(absPath, content, 'utf-8');
            const totalLines = readFileSync(absPath, 'utf-8').split('\n').length;
            const chunkLines = content.split('\n').length;
            return {
                content: `Appended to: ${absPath} (+${chunkLines} lines, total now ${totalLines} lines)`,
            };
        }

        // ─── Normal write (overwrite) ───
        let oldLineCount: number | undefined;
        if (existsSync(absPath)) {
            try {
                oldLineCount = readFileSync(absPath, 'utf-8').split('\n').length;
            } catch { /* ignore read errors on existing files */ }
        }

        writeFileSync(absPath, content, 'utf-8');
        const newLineCount = content.split('\n').length;

        if (oldLineCount !== undefined) {
            return {
                content: `Updated file: ${absPath} (was ${oldLineCount} lines, now ${newLineCount} lines)`,
            };
        }

        return {
            content: `Created file: ${absPath} (${newLineCount} lines)`,
        };
    },
};
