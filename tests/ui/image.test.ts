// ─── Tests for image loading module ───

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isImagePath, loadImageAsBase64, extractImagePaths, clipboardHasImage, loadImageFromClipboard } from '../../src/ui/image.js';

const TEST_DIR = join(tmpdir(), 'deepa-test-image-' + Date.now());

describe('Image Module', () => {
    beforeEach(() => {
        if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    });

    afterEach(() => {
        try {
            const fs = require('fs');
            const files = fs.readdirSync(TEST_DIR);
            for (const f of files) unlinkSync(join(TEST_DIR, f));
            fs.rmdirSync(TEST_DIR);
        } catch { /* ignore */ }
    });

    // ─── isImagePath ───

    describe('isImagePath', () => {
        it('detects .png files', () => {
            expect(isImagePath('screenshot.png')).toBe(true);
        });

        it('detects .jpg files', () => {
            expect(isImagePath('photo.jpg')).toBe(true);
        });

        it('detects .jpeg files', () => {
            expect(isImagePath('photo.jpeg')).toBe(true);
        });

        it('detects .gif files', () => {
            expect(isImagePath('animation.gif')).toBe(true);
        });

        it('detects .webp files', () => {
            expect(isImagePath('image.webp')).toBe(true);
        });

        it('is case-insensitive', () => {
            expect(isImagePath('PHOTO.PNG')).toBe(true);
            expect(isImagePath('Image.JPG')).toBe(true);
        });

        it('handles paths with directories', () => {
            expect(isImagePath('/Users/test/screenshot.png')).toBe(true);
            expect(isImagePath('./images/photo.jpg')).toBe(true);
        });

        it('rejects non-image extensions', () => {
            expect(isImagePath('document.pdf')).toBe(false);
            expect(isImagePath('script.js')).toBe(false);
            expect(isImagePath('data.json')).toBe(false);
            expect(isImagePath('readme.md')).toBe(false);
        });

        it('rejects files with no extension', () => {
            expect(isImagePath('Makefile')).toBe(false);
        });

        it('handles whitespace', () => {
            expect(isImagePath('  photo.png  ')).toBe(true);
        });
    });

    // ─── loadImageAsBase64 ───

    describe('loadImageAsBase64', () => {
        it('loads a PNG file as base64', () => {
            const filePath = join(TEST_DIR, 'test.png');
            // Write a minimal valid content (doesn't need to be a real PNG for this test)
            writeFileSync(filePath, 'fake-png-content');

            const result = loadImageAsBase64(filePath);
            expect(result).not.toBeNull();
            expect(result!.image.type).toBe('image');
            expect(result!.image.source.type).toBe('base64');
            expect(result!.image.source.mediaType).toBe('image/png');
            expect(result!.image.source.data).toBe(Buffer.from('fake-png-content').toString('base64'));
        });

        it('loads a JPG file with correct media type', () => {
            const filePath = join(TEST_DIR, 'test.jpg');
            writeFileSync(filePath, 'fake-jpg');

            const result = loadImageAsBase64(filePath);
            expect(result).not.toBeNull();
            expect(result!.image.source.mediaType).toBe('image/jpeg');
        });

        it('loads a JPEG file with correct media type', () => {
            const filePath = join(TEST_DIR, 'test.jpeg');
            writeFileSync(filePath, 'fake-jpeg');

            const result = loadImageAsBase64(filePath);
            expect(result).not.toBeNull();
            expect(result!.image.source.mediaType).toBe('image/jpeg');
        });

        it('loads a GIF file with correct media type', () => {
            const filePath = join(TEST_DIR, 'test.gif');
            writeFileSync(filePath, 'fake-gif');

            const result = loadImageAsBase64(filePath);
            expect(result).not.toBeNull();
            expect(result!.image.source.mediaType).toBe('image/gif');
        });

        it('loads a WebP file with correct media type', () => {
            const filePath = join(TEST_DIR, 'test.webp');
            writeFileSync(filePath, 'fake-webp');

            const result = loadImageAsBase64(filePath);
            expect(result).not.toBeNull();
            expect(result!.image.source.mediaType).toBe('image/webp');
        });

        it('returns null for nonexistent files', () => {
            expect(loadImageAsBase64('/nonexistent/path.png')).toBeNull();
        });

        it('returns null for unsupported extensions', () => {
            const filePath = join(TEST_DIR, 'test.txt');
            writeFileSync(filePath, 'text content');
            expect(loadImageAsBase64(filePath)).toBeNull();
        });

        it('resolves relative paths with cwd', () => {
            const filePath = join(TEST_DIR, 'relative.png');
            writeFileSync(filePath, 'content');

            const result = loadImageAsBase64('relative.png', TEST_DIR);
            expect(result).not.toBeNull();
            expect(result!.image.source.mediaType).toBe('image/png');
        });

        it('warns for large files (>5MB)', () => {
            const filePath = join(TEST_DIR, 'large.png');
            // Create a 6MB file
            const bigContent = Buffer.alloc(6 * 1024 * 1024, 'x');
            writeFileSync(filePath, bigContent);

            const result = loadImageAsBase64(filePath);
            expect(result).not.toBeNull();
            expect(result!.warning).toBeDefined();
            expect(result!.warning).toContain('MB');
        });

        it('no warning for small files', () => {
            const filePath = join(TEST_DIR, 'small.png');
            writeFileSync(filePath, 'tiny');

            const result = loadImageAsBase64(filePath);
            expect(result).not.toBeNull();
            expect(result!.warning).toBeUndefined();
        });
    });

    // ─── extractImagePaths ───

    describe('extractImagePaths', () => {
        it('extracts a single image path', () => {
            const result = extractImagePaths('describe screenshot.png');
            expect(result.paths).toEqual(['screenshot.png']);
            expect(result.text).toBe('describe');
        });

        it('extracts multiple image paths', () => {
            const result = extractImagePaths('compare a.png b.jpg');
            expect(result.paths).toEqual(['a.png', 'b.jpg']);
            expect(result.text).toBe('compare');
        });

        it('handles input with no images', () => {
            const result = extractImagePaths('just regular text');
            expect(result.paths).toEqual([]);
            expect(result.text).toBe('just regular text');
        });

        it('handles input that is only an image path', () => {
            const result = extractImagePaths('screenshot.png');
            expect(result.paths).toEqual(['screenshot.png']);
            expect(result.text).toBe('');
        });

        it('preserves text around image paths', () => {
            const result = extractImagePaths('what is in this photo.jpg please explain');
            expect(result.paths).toEqual(['photo.jpg']);
            expect(result.text).toBe('what is in this please explain');
        });

        it('handles paths with directories', () => {
            const result = extractImagePaths('analyze ./screenshots/error.png');
            expect(result.paths).toEqual(['./screenshots/error.png']);
            expect(result.text).toBe('analyze');
        });
    });

    // ─── Clipboard functions ───

    describe('clipboardHasImage', () => {
        it('returns a boolean', () => {
            const result = clipboardHasImage();
            expect(typeof result).toBe('boolean');
        });

        it('does not throw on any platform', () => {
            expect(() => clipboardHasImage()).not.toThrow();
        });
    });

    describe('loadImageFromClipboard', () => {
        it('returns null or valid ImageContent', () => {
            const result = loadImageFromClipboard();
            if (result !== null) {
                expect(result.image.type).toBe('image');
                expect(result.image.source.type).toBe('base64');
                expect(result.image.source.mediaType).toBe('image/png');
                expect(typeof result.image.source.data).toBe('string');
                expect(typeof result.fileName).toBe('string');
                expect(result.fileName).toContain('clipboard-');
            }
        });

        it('does not throw on any platform', () => {
            expect(() => loadImageFromClipboard()).not.toThrow();
        });
    });
});
