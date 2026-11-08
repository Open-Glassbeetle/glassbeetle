import { describe, expect, it } from 'vitest';
import {
  formatContentDisposition,
  parseRangeHeader,
  resolveContentSecurityPolicy,
  SAFE_INLINE_MIME_TYPES,
  sanitizeFilename,
} from './artifacts-content-policy.js';

describe('Artifact Content Security Policy', () => {
  describe('SAFE_INLINE_MIME_TYPES', () => {
    it('contains safe document and text formats', () => {
      expect(SAFE_INLINE_MIME_TYPES.has('text/plain')).toBe(true);
      expect(SAFE_INLINE_MIME_TYPES.has('text/markdown')).toBe(true);
      expect(SAFE_INLINE_MIME_TYPES.has('application/json')).toBe(true);
      expect(SAFE_INLINE_MIME_TYPES.has('text/csv')).toBe(true);
    });

    it('contains safe raster image formats', () => {
      expect(SAFE_INLINE_MIME_TYPES.has('image/png')).toBe(true);
      expect(SAFE_INLINE_MIME_TYPES.has('image/jpeg')).toBe(true);
      expect(SAFE_INLINE_MIME_TYPES.has('image/webp')).toBe(true);
      expect(SAFE_INLINE_MIME_TYPES.has('image/gif')).toBe(true);
    });

    it('explicitly excludes executable and script-bearing types (XSS prevention)', () => {
      expect(SAFE_INLINE_MIME_TYPES.has('text/html')).toBe(false);
      expect(SAFE_INLINE_MIME_TYPES.has('application/xhtml+xml')).toBe(false);
      expect(SAFE_INLINE_MIME_TYPES.has('image/svg+xml')).toBe(false);
      expect(SAFE_INLINE_MIME_TYPES.has('application/javascript')).toBe(false);
      expect(SAFE_INLINE_MIME_TYPES.has('text/javascript')).toBe(false);
      expect(SAFE_INLINE_MIME_TYPES.has('application/pdf')).toBe(false);
    });
  });

  describe('sanitizeFilename', () => {
    it('removes directory traversal sequences', () => {
      expect(sanitizeFilename('../../../secret.txt')).toBe('secret.txt');
      expect(sanitizeFilename('..\\..\\passwords.csv')).toBe('passwords.csv');
      expect(sanitizeFilename('/etc/hosts')).toBe('hosts');
    });

    it('removes CRLF and control characters to prevent HTTP response splitting', () => {
      expect(sanitizeFilename('report\r\nSet-Cookie: evil=1.txt')).toBe(
        'reportSet-Cookie: evil=1.txt',
      );
      expect(sanitizeFilename('file\x00name.png')).toBe('filename.png');
    });

    it('escapes quotes and backslashes', () => {
      expect(sanitizeFilename('malicious"; filename="hacked.txt')).toBe(
        'malicious_; filename=_hacked.txt',
      );
    });

    it('returns empty string for inputs that resolve to root or dots', () => {
      expect(sanitizeFilename('')).toBe('');
      expect(sanitizeFilename('...')).toBe('');
      expect(sanitizeFilename('..')).toBe('');
      expect(sanitizeFilename('.')).toBe('');
    });

    it('preserves unicode characters', () => {
      expect(sanitizeFilename("rapport_d'été_🚀.md")).toBe(
        "rapport_d'été_🚀.md",
      );
    });
  });

  describe('formatContentDisposition', () => {
    it('returns disposition bare when no filename is given', () => {
      expect(formatContentDisposition('inline')).toBe('inline');
      expect(formatContentDisposition('attachment')).toBe('attachment');
    });

    it('formats pure ASCII filenames without spaces directly', () => {
      expect(formatContentDisposition('inline', 'report.md')).toBe(
        'inline; filename="report.md"',
      );
      expect(formatContentDisposition('attachment', 'archive.zip')).toBe(
        'attachment; filename="archive.zip"',
      );
    });

    it('formats unicode and space-containing filenames with RFC 5987 encoding', () => {
      const formatted = formatContentDisposition('inline', 'my report.md');
      expect(formatted).toContain('filename="my report.md"');
      expect(formatted).toContain("filename*=UTF-8''my%20report.md");

      const unicode = formatContentDisposition('attachment', 'über_file.bin');
      expect(unicode).toContain('filename="_ber_file.bin"');
      expect(unicode).toContain("filename*=UTF-8''%C3%BCber_file.bin");
    });
  });

  describe('resolveContentSecurityPolicy', () => {
    it('serves safe markdown inline with charset', () => {
      const res = resolveContentSecurityPolicy({
        mimeType: 'text/markdown',
        isInline: true,
        title: 'Notes.md',
      });
      expect(res.contentType).toBe('text/markdown; charset=utf-8');
      expect(res.disposition).toContain('inline');
    });

    it('serves safe raster images inline without charset', () => {
      const res = resolveContentSecurityPolicy({
        mimeType: 'image/png',
        isInline: false,
        title: 'diagram.png',
      });
      expect(res.contentType).toBe('image/png');
      expect(res.disposition).toContain('inline');
    });

    it('demotes text/html to application/octet-stream and forces attachment (stored XSS defense)', () => {
      const res = resolveContentSecurityPolicy({
        mimeType: 'text/html',
        isInline: true,
        title: 'malicious.html',
      });
      expect(res.contentType).toBe('application/octet-stream');
      expect(res.disposition).toContain('attachment');
    });

    it('demotes image/svg+xml to application/octet-stream and forces attachment (active SVG XSS defense)', () => {
      const res = resolveContentSecurityPolicy({
        mimeType: 'image/svg+xml',
        isInline: false,
        title: 'vector.svg',
      });
      expect(res.contentType).toBe('application/octet-stream');
      expect(res.disposition).toContain('attachment');
    });

    it('falls back safely for null mimeType on inline content (text/plain, inline)', () => {
      const res = resolveContentSecurityPolicy({
        mimeType: null,
        isInline: true,
        title: 'Plain text',
      });
      expect(res.contentType).toBe('text/plain; charset=utf-8');
      expect(res.disposition).toContain('inline');
    });

    it('falls back safely for null mimeType on file content (application/octet-stream, attachment)', () => {
      const res = resolveContentSecurityPolicy({
        mimeType: null,
        isInline: false,
        title: 'blob.bin',
      });
      expect(res.contentType).toBe('application/octet-stream');
      expect(res.disposition).toContain('attachment');
    });
  });

  describe('parseRangeHeader', () => {
    it('returns null when header is absent or invalid', () => {
      expect(parseRangeHeader(undefined, 1000)).toBeNull();
      expect(parseRangeHeader('', 1000)).toBeNull();
      expect(parseRangeHeader('items=0-10', 1000)).toBeNull();
      expect(parseRangeHeader('invalid', 1000)).toBeNull();
    });

    it('parses explicit byte ranges', () => {
      expect(parseRangeHeader('bytes=0-499', 1000)).toEqual({
        start: 0,
        end: 499,
      });
      expect(parseRangeHeader('bytes=500-999', 1000)).toEqual({
        start: 500,
        end: 999,
      });
    });

    it('parses prefix byte ranges', () => {
      expect(parseRangeHeader('bytes=500-', 1000)).toEqual({
        start: 500,
        end: 999,
      });
    });

    it('parses suffix byte ranges', () => {
      expect(parseRangeHeader('bytes=-300', 1000)).toEqual({
        start: 700,
        end: 999,
      });
    });

    it('returns unsatisfiable for out-of-bounds or inverted ranges', () => {
      expect(parseRangeHeader('bytes=1000-2000', 1000)).toBe('unsatisfiable');
      expect(parseRangeHeader('bytes=500-200', 1000)).toBe('unsatisfiable');
      expect(parseRangeHeader('bytes=-0', 1000)).toBe('unsatisfiable');
    });
  });
});
