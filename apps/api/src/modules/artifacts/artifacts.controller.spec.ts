import { PassThrough, Readable } from 'node:stream';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import { ArtifactsController } from './artifacts.controller.js';
import { ArtifactsService } from './artifacts.service.js';
import type {
  ArtifactResponseDto,
  ArtifactVersionResponseDto,
  CreateArtifactDto,
  ListArtifactsQueryDto,
  UpdateArtifactDto,
} from './dto/index.js';

describe('ArtifactsController', () => {
  let controller: ArtifactsController;
  let service: ArtifactsService;

  const mockArtifact: ArtifactResponseDto = {
    id: '018f3a9e-0000-7000-8000-000000000001',
    projectId: '018f3a9e-0000-7000-8000-000000000002',
    chatId: '018f3a9e-0000-7000-8000-000000000003',
    agentId: '018f3a9e-0000-7000-8000-000000000004',
    title: 'Test Artifact',
    type: 'document',
    mimeType: 'text/markdown',
    content: '# Test Content',
    hasFile: false,
    version: 1,
    createdAt: '2026-09-21T09:30:52.000Z',
    updatedAt: '2026-09-21T09:30:52.000Z',
  };

  const mockVersion: ArtifactVersionResponseDto = {
    id: '018f3a9e-0000-7000-8000-000000000010',
    artifactId: mockArtifact.id,
    version: 1,
    title: 'Historical Draft',
    type: 'document',
    mimeType: 'text/markdown',
    content: '# Old Draft',
    hasFile: false,
    createdAt: '2026-09-21T09:30:52.000Z',
  };

  const mockPaginatedResponse: PaginatedResponse<ArtifactResponseDto> = {
    items: [mockArtifact],
    total: 1,
    limit: 50,
    offset: 0,
  };

  const mockPaginatedVersionsResponse: PaginatedResponse<ArtifactVersionResponseDto> =
    {
      items: [mockVersion],
      total: 1,
      limit: 50,
      offset: 0,
    };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArtifactsController],
      providers: [
        {
          provide: ArtifactsService,
          useValue: {
            findAll: vi.fn().mockResolvedValue(mockPaginatedResponse),
            findOne: vi.fn().mockResolvedValue(mockArtifact),
            openContent: vi.fn(),
            create: vi.fn().mockResolvedValue(mockArtifact),
            update: vi.fn().mockResolvedValue(mockArtifact),
            delete: vi.fn().mockResolvedValue(undefined),
            uploadContent: vi.fn().mockResolvedValue(mockArtifact),
            findAllVersions: vi
              .fn()
              .mockResolvedValue(mockPaginatedVersionsResponse),
            findOneVersion: vi.fn().mockResolvedValue(mockVersion),
            openVersionContent: vi.fn(),
            restoreVersion: vi.fn().mockResolvedValue(mockArtifact),
          },
        },
      ],
    }).compile();

    controller = module.get<ArtifactsController>(ArtifactsController);
    service = module.get<ArtifactsService>(ArtifactsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('delegates to artifactsService.findAll and returns paginated result', async () => {
      const query: ListArtifactsQueryDto = {
        limit: 10,
        offset: 0,
        type: 'document',
      };
      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toBe(mockPaginatedResponse);
    });
  });

  describe('findOne', () => {
    it('delegates to artifactsService.findOne and returns artifact', async () => {
      const result = await controller.findOne(mockArtifact.id);

      expect(service.findOne).toHaveBeenCalledWith(mockArtifact.id);
      expect(result).toBe(mockArtifact);
    });
  });

  describe('create', () => {
    it('creates an artifact, sets Location header, and returns created artifact', async () => {
      const dto: CreateArtifactDto = {
        title: 'New Artifact',
        type: 'document',
        content: '# Spec',
      };
      const res = {
        setHeader: vi.fn(),
      } as unknown as Response;

      const result = await controller.create(dto, res);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Location',
        `/api/v1/artifacts/${mockArtifact.id}`,
      );
      expect(result).toBe(mockArtifact);
    });
  });

  describe('update', () => {
    it('delegates to artifactsService.update and returns updated artifact', async () => {
      const dto: UpdateArtifactDto = {
        title: 'Updated Title',
      };

      const result = await controller.update(mockArtifact.id, dto);

      expect(service.update).toHaveBeenCalledWith(mockArtifact.id, dto);
      expect(result).toBe(mockArtifact);
    });
  });

  describe('delete', () => {
    it('delegates to artifactsService.delete', async () => {
      await controller.delete(mockArtifact.id);

      expect(service.delete).toHaveBeenCalledWith(mockArtifact.id);
    });
  });

  describe('getContent', () => {
    const createMockResponse = () => {
      const passThrough = new PassThrough();
      const headers: Record<string, string | number> = {};
      vi.spyOn(passThrough, 'end');
      const res = Object.assign(passThrough, {
        headers,
        setHeader: vi.fn((k: string, v: string | number) => {
          headers[k.toLowerCase()] = v;
          return res;
        }),
        status: vi.fn().mockReturnThis(),
        headersSent: false,
      });
      return res as unknown as Response & {
        headers: Record<string, string | number>;
      };
    };

    it('returns inline content directly with appropriate headers', async () => {
      const inlineDescriptor = {
        kind: 'inline' as const,
        id: mockArtifact.id,
        title: 'Notes.md',
        version: 1,
        mimeType: 'text/markdown',
        updatedAt: '2026-09-21T09:30:52.000Z',
        content: '# Title',
        size: 7,
      };
      vi.spyOn(service, 'openContent').mockResolvedValue(inlineDescriptor);

      const req = { headers: {} } as Request;
      const res = createMockResponse();

      await controller.getContent(mockArtifact.id, req, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/markdown; charset=utf-8',
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 7);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('inline'),
      );
      expect(res.end).toHaveBeenCalledWith('# Title');
    });

    it('returns 304 Not Modified when ETag matches If-None-Match', async () => {
      const inlineDescriptor = {
        kind: 'inline' as const,
        id: mockArtifact.id,
        title: 'Notes.md',
        version: 1,
        mimeType: 'text/markdown',
        updatedAt: '2026-09-21T09:30:52.000Z',
        content: '# Title',
        size: 7,
      };
      vi.spyOn(service, 'openContent').mockResolvedValue(inlineDescriptor);

      const req = {
        headers: { 'if-none-match': '"1-7"' },
      } as unknown as Request;
      const res = createMockResponse();

      await controller.getContent(mockArtifact.id, req, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
      expect(res.end).toHaveBeenCalled();
    });

    describe('inline content byte ranges', () => {
      // "héllo wörld" is 11 characters but 13 UTF-8 bytes.
      const content = 'h\u00e9llo w\u00f6rld';
      const size = Buffer.byteLength(content, 'utf-8');
      const inlineDescriptor = {
        kind: 'inline' as const,
        id: mockArtifact.id,
        title: 'Notes.txt',
        version: 1,
        mimeType: 'text/plain',
        updatedAt: '2026-09-21T09:30:52.000Z',
        content,
        size,
      };

      it('returns 206 with the requested UTF-8 bytes', async () => {
        vi.spyOn(service, 'openContent').mockResolvedValue(inlineDescriptor);
        const req = {
          headers: { range: 'bytes=0-2' },
        } as unknown as Request;
        const res = createMockResponse();

        await controller.getContent(mockArtifact.id, req, res);

        expect(size).toBe(13);
        expect(res.status).toHaveBeenCalledWith(HttpStatus.PARTIAL_CONTENT);
        expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
        expect(res.setHeader).toHaveBeenCalledWith(
          'Content-Range',
          `bytes 0-2/${size}`,
        );
        expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 3);
        const body = (res.end as ReturnType<typeof vi.fn>).mock
          .calls[0][0] as Buffer;
        expect(Buffer.isBuffer(body)).toBe(true);
        expect(body.equals(Buffer.from(content, 'utf-8').subarray(0, 3))).toBe(
          true,
        );
      });

      it('supports suffix ranges', async () => {
        vi.spyOn(service, 'openContent').mockResolvedValue(inlineDescriptor);
        const req = {
          headers: { range: 'bytes=-5' },
        } as unknown as Request;
        const res = createMockResponse();

        await controller.getContent(mockArtifact.id, req, res);

        expect(res.status).toHaveBeenCalledWith(HttpStatus.PARTIAL_CONTENT);
        expect(res.setHeader).toHaveBeenCalledWith(
          'Content-Range',
          `bytes ${size - 5}-${size - 1}/${size}`,
        );
        const body = (res.end as ReturnType<typeof vi.fn>).mock
          .calls[0][0] as Buffer;
        expect(body.toString('utf-8')).toBe('w\u00f6rld'.slice(-4));
      });

      it('returns 416 when the range is unsatisfiable', async () => {
        vi.spyOn(service, 'openContent').mockResolvedValue(inlineDescriptor);
        const req = {
          headers: { range: 'bytes=9999-' },
        } as unknown as Request;
        const res = createMockResponse();

        await controller.getContent(mockArtifact.id, req, res);

        expect(res.status).toHaveBeenCalledWith(
          HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
        );
        expect(res.setHeader).toHaveBeenCalledWith(
          'Content-Range',
          `bytes */${size}`,
        );
      });

      it('ignores the range and returns 200 when If-Range does not match', async () => {
        vi.spyOn(service, 'openContent').mockResolvedValue(inlineDescriptor);
        const req = {
          headers: { range: 'bytes=0-2', 'if-range': '"0-0"' },
        } as unknown as Request;
        const res = createMockResponse();

        await controller.getContent(mockArtifact.id, req, res);

        expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
        expect(res.setHeader).toHaveBeenCalledWith('Content-Length', size);
        expect(res.end).toHaveBeenCalledWith(content);
      });
    });

    it('streams file content without Range header', async () => {
      const stream = Readable.from(['chunk1', 'chunk2']);
      const fileDescriptor = {
        kind: 'file' as const,
        id: mockArtifact.id,
        title: 'file.bin',
        version: 1,
        mimeType: null,
        updatedAt: '2026-09-21T09:30:52.000Z',
        filePath: 'artifacts/file.bin',
        size: 12,
        openStream: vi.fn().mockResolvedValue(stream),
      };
      vi.spyOn(service, 'openContent').mockResolvedValue(fileDescriptor);

      const req = { headers: {} } as Request;
      const res = createMockResponse();

      await controller.getContent(mockArtifact.id, req, res);

      expect(fileDescriptor.openStream).toHaveBeenCalledWith();
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 12);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/octet-stream',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment'),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff',
      );
    });

    it('supports 206 Partial Content when Range header is provided', async () => {
      const stream = Readable.from(['sub-chunk']);
      const fileDescriptor = {
        kind: 'file' as const,
        id: mockArtifact.id,
        title: 'file.bin',
        version: 1,
        mimeType: 'application/octet-stream',
        updatedAt: '2026-09-21T09:30:52.000Z',
        filePath: 'artifacts/file.bin',
        size: 100,
        openStream: vi.fn().mockResolvedValue(stream),
      };
      vi.spyOn(service, 'openContent').mockResolvedValue(fileDescriptor);

      const req = {
        headers: { range: 'bytes=0-49' },
      } as unknown as Request;
      const res = createMockResponse();

      await controller.getContent(mockArtifact.id, req, res);

      expect(fileDescriptor.openStream).toHaveBeenCalledWith({
        start: 0,
        end: 49,
      });
      expect(res.status).toHaveBeenCalledWith(HttpStatus.PARTIAL_CONTENT);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Range',
        'bytes 0-49/100',
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 50);
    });

    it('returns 416 Range Not Satisfiable when range is out of bounds', async () => {
      const fileDescriptor = {
        kind: 'file' as const,
        id: mockArtifact.id,
        title: 'file.bin',
        version: 1,
        mimeType: 'application/octet-stream',
        updatedAt: '2026-09-21T09:30:52.000Z',
        filePath: 'artifacts/file.bin',
        size: 100,
        openStream: vi.fn(),
      };
      vi.spyOn(service, 'openContent').mockResolvedValue(fileDescriptor);

      const req = {
        headers: { range: 'bytes=200-300' },
      } as unknown as Request;
      const res = createMockResponse();

      await controller.getContent(mockArtifact.id, req, res);

      expect(fileDescriptor.openStream).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Range',
        'bytes */100',
      );
    });

    it('demotes text/html to application/octet-stream and forces attachment (stored XSS defense)', async () => {
      const htmlDescriptor = {
        kind: 'inline' as const,
        id: mockArtifact.id,
        title: 'evil.html',
        version: 1,
        mimeType: 'text/html',
        updatedAt: '2026-09-21T09:30:52.000Z',
        content: '<script>alert("xss")</script>',
        size: 29,
      };
      vi.spyOn(service, 'openContent').mockResolvedValue(htmlDescriptor);

      const req = { headers: {} } as Request;
      const res = createMockResponse();

      await controller.getContent(mockArtifact.id, req, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/octet-stream',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment'),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff',
      );
    });
  });

  describe('uploadContent', () => {
    it('delegates file upload to artifactsService.uploadContent', async () => {
      const mockFile = {
        buffer: Buffer.from('file-bytes'),
        size: 10,
        originalname: 'doc.bin',
        mimetype: 'application/octet-stream',
      } as Express.Multer.File;

      const result = await controller.uploadContent(mockArtifact.id, mockFile);

      expect(service.uploadContent).toHaveBeenCalledWith(
        mockArtifact.id,
        mockFile,
      );
      expect(result).toBe(mockArtifact);
    });

    it('throws BadRequestException if no file or empty file uploaded', async () => {
      await expect(
        controller.uploadContent(mockArtifact.id, undefined),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.uploadContent(mockArtifact.id, {
          buffer: Buffer.alloc(0),
        } as Express.Multer.File),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAllVersions', () => {
    it('delegates to artifactsService.findAllVersions', async () => {
      const query = { limit: 10, offset: 0 };
      const result = await controller.findAllVersions(mockArtifact.id, query);

      expect(service.findAllVersions).toHaveBeenCalledWith(
        mockArtifact.id,
        query,
      );
      expect(result).toBe(mockPaginatedVersionsResponse);
    });
  });

  describe('findOneVersion', () => {
    it('delegates to artifactsService.findOneVersion', async () => {
      const result = await controller.findOneVersion(mockArtifact.id, 1);

      expect(service.findOneVersion).toHaveBeenCalledWith(mockArtifact.id, 1);
      expect(result).toBe(mockVersion);
    });
  });

  describe('getVersionContent', () => {
    const createMockResponse = () => {
      const passThrough = new PassThrough();
      const headers: Record<string, string | number> = {};
      vi.spyOn(passThrough, 'end');
      const res = Object.assign(passThrough, {
        headers,
        setHeader: vi.fn((k: string, v: string | number) => {
          headers[k.toLowerCase()] = v;
          return res;
        }),
        status: vi.fn().mockReturnThis(),
        headersSent: false,
      });
      return res as unknown as Response & {
        headers: Record<string, string | number>;
      };
    };

    it('streams version content with appropriate security headers', async () => {
      const versionDescriptor = {
        kind: 'inline' as const,
        id: mockVersion.id,
        title: 'Draft.md',
        version: 1,
        mimeType: 'text/markdown',
        updatedAt: '2026-09-21T09:30:52.000Z',
        content: '# Historical text',
        size: 17,
      };
      vi.spyOn(service, 'openVersionContent').mockResolvedValue(
        versionDescriptor,
      );

      const req = { headers: {} } as Request;
      const res = createMockResponse();

      await controller.getVersionContent(mockArtifact.id, 1, req, res);

      expect(service.openVersionContent).toHaveBeenCalledWith(
        mockArtifact.id,
        1,
      );
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff',
      );
      expect(res.end).toHaveBeenCalledWith('# Historical text');
    });
  });

  describe('restoreVersion', () => {
    it('delegates to artifactsService.restoreVersion', async () => {
      const result = await controller.restoreVersion(mockArtifact.id, 1);

      expect(service.restoreVersion).toHaveBeenCalledWith(mockArtifact.id, 1);
      expect(result).toBe(mockArtifact);
    });
  });
});
