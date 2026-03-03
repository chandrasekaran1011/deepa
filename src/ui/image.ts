// ─── Image loading utilities ───
// Detects image file paths and loads them as base64 for vision APIs.
// Supports clipboard paste on macOS via osascript.

import { readFileSync, existsSync, statSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { extname, resolve, join, basename, isAbsolute } from 'path';
import { platform, homedir, tmpdir } from 'os';
import type { ImageContent } from '../types.js';

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Check if a string looks like an image file path.
 */
export function isImagePath(input: string): boolean {
    const ext = extname(input.trim()).toLowerCase();
    return ext in IMAGE_EXTENSIONS;
}

/**
 * Load an image file as base64-encoded ImageContent.
 * Returns null if the file doesn't exist or isn't a supported format.
 * Returns { content, warning } if file is too large.
 */
export function loadImageAsBase64(filePath: string, cwd?: string): { image: ImageContent; warning?: string } | null {
    const absPath = isAbsolute(filePath) ? filePath : resolve(cwd || process.cwd(), filePath);

    if (!existsSync(absPath)) return null;

    const ext = extname(absPath).toLowerCase();
    const mediaType = IMAGE_EXTENSIONS[ext];
    if (!mediaType) return null;

    const stat = statSync(absPath);
    let warning: string | undefined;
    if (stat.size > MAX_IMAGE_SIZE) {
        warning = `Image is ${(stat.size / 1024 / 1024).toFixed(1)}MB — large images may slow down API calls`;
    }

    const data = readFileSync(absPath).toString('base64');

    return {
        image: {
            type: 'image',
            source: { type: 'base64', mediaType, data },
        },
        warning,
    };
}

/**
 * Extract image file paths from user input text.
 * Returns the paths found and the text with paths removed.
 */
export function extractImagePaths(input: string): { text: string; paths: string[] } {
    const words = input.split(/\s+/);
    const paths: string[] = [];
    const textParts: string[] = [];

    for (const word of words) {
        if (isImagePath(word)) {
            paths.push(word);
        } else {
            textParts.push(word);
        }
    }

    return {
        text: textParts.join(' ').trim(),
        paths,
    };
}

// ─── Clipboard image support ───

/**
 * Check if the system clipboard contains an image.
 * Currently macOS only (uses osascript).
 */
export function clipboardHasImage(): boolean {
    if (platform() !== 'darwin') return false;
    try {
        const result = execSync(
            `osascript -e 'try
                set imgData to the clipboard as «class PNGf»
                return "yes"
            on error
                return "no"
            end try'`,
            { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] },
        ).trim();
        return result === 'yes';
    } catch {
        return false;
    }
}

/**
 * Read an image from the system clipboard and return as ImageContent.
 * Saves clipboard image to a temp file, reads as base64, then cleans up.
 * Returns null if no image is on the clipboard.
 * Currently macOS only.
 */
export function loadImageFromClipboard(): { image: ImageContent; fileName: string } | null {
    if (platform() !== 'darwin') return null;

    const tmpDir = join(tmpdir(), 'deepa-clipboard');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

    const timestamp = Date.now();
    const tmpFile = join(tmpDir, `clipboard-${timestamp}.png`);

    try {
        // Use osascript to write clipboard PNG data to a temp file
        execSync(
            `osascript -e '
                set tmpFile to POSIX file "${tmpFile}"
                try
                    set imgData to the clipboard as «class PNGf»
                    set fp to open for access tmpFile with write permission
                    write imgData to fp
                    close access fp
                    return "ok"
                on error errMsg
                    return "error: " & errMsg
                end try
            '`,
            { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] },
        );

        if (!existsSync(tmpFile)) return null;

        const stat = statSync(tmpFile);
        if (stat.size === 0) {
            unlinkSync(tmpFile);
            return null;
        }

        const data = readFileSync(tmpFile).toString('base64');
        const fileName = `clipboard-${timestamp}.png`;

        return {
            image: {
                type: 'image',
                source: { type: 'base64', mediaType: 'image/png', data },
            },
            fileName,
        };
    } catch {
        return null;
    } finally {
        try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}
