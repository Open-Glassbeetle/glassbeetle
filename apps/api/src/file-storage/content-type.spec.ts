import { describe, expect, it } from 'vitest';
import {
  detectContentType,
  getExtensionForMime,
  normalizeMimeType,
  validateFile,
} from './content-type.js';
import {
  FilePayloadTooLargeError,
  UnsupportedMediaTypeError,
} from './file-storage.errors.js';

describe('ContentType detection & validation', () => {
  describe('detectContentType', () => {
    it('detects JPEG from magic bytes', () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = detectContentType(jpeg);
      expect(result.mime).toBe('image/jpeg');
      expect(result.extension).toBe('.jpg');
    });

    it('detects PNG from magic bytes', () => {
      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
      ]);
      const result = detectContentType(png);
      expect(result.mime).toBe('image/png');
      expect(result.extension).toBe('.png');
    });

    it('detects GIF87a and GIF89a', () => {
      const gif87 = Buffer.from('GIF87a...');
      const gif89 = Buffer.from('GIF89a...');
      expect(detectContentType(gif87)).toEqual({
        mime: 'image/gif',
        extension: '.gif',
      });
      expect(detectContentType(gif89)).toEqual({
        mime: 'image/gif',
        extension: '.gif',
      });
    });

    it('detects WebP from RIFF header', () => {
      const webp = Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('WEBP'),
      ]);
      expect(detectContentType(webp)).toEqual({
        mime: 'image/webp',
        extension: '.webp',
      });
    });

    it('detects WAV from RIFF header', () => {
      const wav = Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('WAVE'),
      ]);
      expect(detectContentType(wav)).toEqual({
        mime: 'audio/wav',
        extension: '.wav',
      });
    });

    it('detects AVIF and MP4 from ftyp box', () => {
      const avif = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x20]),
        Buffer.from('ftypavif'),
      ]);
      expect(detectContentType(avif)).toEqual({
        mime: 'image/avif',
        extension: '.avif',
      });

      const mp4 = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x20]),
        Buffer.from('ftypisom'),
      ]);
      expect(detectContentType(mp4)).toEqual({
        mime: 'video/mp4',
        extension: '.mp4',
      });
    });

    it('detects BMP from BM header', () => {
      const bmp = Buffer.from('BM....');
      expect(detectContentType(bmp)).toEqual({
        mime: 'image/bmp',
        extension: '.bmp',
      });
    });

    it('detects TIFF (little and big endian)', () => {
      const tiffLe = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
      const tiffBe = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);
      expect(detectContentType(tiffLe)).toEqual({
        mime: 'image/tiff',
        extension: '.tiff',
      });
      expect(detectContentType(tiffBe)).toEqual({
        mime: 'image/tiff',
        extension: '.tiff',
      });
    });

    it('detects ICO', () => {
      const ico = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
      expect(detectContentType(ico)).toEqual({
        mime: 'image/x-icon',
        extension: '.ico',
      });
    });

    it('detects PDF', () => {
      const pdf = Buffer.from('%PDF-1.7\n...');
      expect(detectContentType(pdf)).toEqual({
        mime: 'application/pdf',
        extension: '.pdf',
      });
    });

    it('detects ZIP archive', () => {
      const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
      expect(detectContentType(zip)).toEqual({
        mime: 'application/zip',
        extension: '.zip',
      });
    });

    it('detects GZIP archive', () => {
      const gzip = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
      expect(detectContentType(gzip)).toEqual({
        mime: 'application/gzip',
        extension: '.gz',
      });
    });

    it('detects SQLite3 database format', () => {
      const sqlite = Buffer.from('SQLite format 3\0\x04\x00\x01\x01');
      expect(detectContentType(sqlite)).toEqual({
        mime: 'application/vnd.sqlite3',
        extension: '.db',
      });
    });

    it('detects MP3', () => {
      const mp3Id3 = Buffer.from('ID3...');
      const mp3Frame = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
      expect(detectContentType(mp3Id3)).toEqual({
        mime: 'audio/mpeg',
        extension: '.mp3',
      });
      expect(detectContentType(mp3Frame)).toEqual({
        mime: 'audio/mpeg',
        extension: '.mp3',
      });
    });

    it('detects WebM / Matroska', () => {
      const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42]);
      expect(detectContentType(webm)).toEqual({
        mime: 'video/webm',
        extension: '.webm',
      });
    });

    it('detects SVG with XML declaration or direct <svg tag', () => {
      const svgWithXml = Buffer.from(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      );
      const svgDirect = Buffer.from(
        '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><circle/></svg>',
      );
      expect(detectContentType(svgWithXml)).toEqual({
        mime: 'image/svg+xml',
        extension: '.svg',
      });
      expect(detectContentType(svgDirect)).toEqual({
        mime: 'image/svg+xml',
        extension: '.svg',
      });
    });

    it('detects HTML document', () => {
      const htmlDoc = Buffer.from(
        '<!DOCTYPE html><html><head><title>Test</title></head></html>',
      );
      expect(detectContentType(htmlDoc)).toEqual({
        mime: 'text/html',
        extension: '.html',
      });
    });

    it('detects XML document', () => {
      const xmlDoc = Buffer.from(
        '<?xml version="1.0"?><data><item>1</item></data>',
      );
      expect(detectContentType(xmlDoc)).toEqual({
        mime: 'application/xml',
        extension: '.xml',
      });
    });

    it('detects JSON document', () => {
      const jsonDoc = Buffer.from('{"key": "value", "count": 42}');
      const jsonArray = Buffer.from('[1, 2, 3, 4]');
      expect(detectContentType(jsonDoc)).toEqual({
        mime: 'application/json',
        extension: '.json',
      });
      expect(detectContentType(jsonArray)).toEqual({
        mime: 'application/json',
        extension: '.json',
      });
    });

    it('detects plain text', () => {
      const plainText = Buffer.from('Hello world! This is simple plain text.');
      expect(detectContentType(plainText)).toEqual({
        mime: 'text/plain',
        extension: '.txt',
      });
    });

    it('falls back to application/octet-stream for arbitrary binary data', () => {
      const arbitraryBinary = Buffer.from([0x00, 0x12, 0xfe, 0xba, 0xbe, 0x01]);
      expect(detectContentType(arbitraryBinary)).toEqual({
        mime: 'application/octet-stream',
        extension: '.bin',
      });
    });

    it('handles empty buffer as application/octet-stream', () => {
      expect(detectContentType(Buffer.alloc(0))).toEqual({
        mime: 'application/octet-stream',
        extension: '.bin',
      });
    });
  });

  describe('getExtensionForMime and normalizeMimeType', () => {
    it('normalizes aliases correctly', () => {
      expect(normalizeMimeType('image/jpg')).toBe('image/jpeg');
      expect(normalizeMimeType('image/x-png')).toBe('image/png');
      expect(normalizeMimeType('application/x-sqlite3')).toBe(
        'application/vnd.sqlite3',
      );
      expect(normalizeMimeType('application/x-gzip')).toBe('application/gzip');
    });

    it('returns canonical extension', () => {
      expect(getExtensionForMime('image/jpeg')).toBe('.jpg');
      expect(getExtensionForMime('image/png')).toBe('.png');
      expect(getExtensionForMime('application/pdf')).toBe('.pdf');
      expect(getExtensionForMime('application/vnd.sqlite3')).toBe('.db');
      expect(getExtensionForMime('unknown/type')).toBe('.bin');
    });
  });

  describe('validateFile', () => {
    it('allows content within maxBytes', () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const result = validateFile(buf, { maxBytes: 100 });
      expect(result.mime).toBe('image/jpeg');
    });

    it('rejects content exceeding maxBytes with FilePayloadTooLargeError', () => {
      const buf = Buffer.alloc(101);
      expect(() => validateFile(buf, { maxBytes: 100 })).toThrow(
        FilePayloadTooLargeError,
      );
    });

    it('validates allowed MIME types matching exact detected type', () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const result = validateFile(png, {
        allowedMimeTypes: ['image/png', 'image/jpeg'],
      });
      expect(result.mime).toBe('image/png');
    });

    it('validates wildcard allowed MIME types', () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const result = validateFile(png, {
        allowedMimeTypes: ['image/*'],
      });
      expect(result.mime).toBe('image/png');
    });

    it('rejects when detected MIME type is not allowed', () => {
      const pdf = Buffer.from('%PDF-1.4');
      expect(() =>
        validateFile(pdf, { allowedMimeTypes: ['image/jpeg', 'image/png'] }),
      ).toThrow(UnsupportedMediaTypeError);
    });
  });
});
