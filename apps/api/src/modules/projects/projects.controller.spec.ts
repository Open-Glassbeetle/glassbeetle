import { BadRequestException, StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import type {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectResponseDto,
  UpdateProjectDto,
} from './dto/index.js';

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let service: ProjectsService;

  const mockProject: ProjectResponseDto = {
    id: '018f3a9e-0000-7000-8000-000000000001',
    name: 'Test Project',
    description: 'A test project description',
    hasImage: false,
    chatCount: 0,
    artifactCount: 0,
    createdAt: '2026-09-21T09:30:52.000Z',
    updatedAt: '2026-09-21T09:30:52.000Z',
  };

  const mockPaginatedResponse: PaginatedResponse<ProjectResponseDto> = {
    items: [mockProject],
    total: 1,
    limit: 50,
    offset: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        {
          provide: ProjectsService,
          useValue: {
            findAll: vi.fn().mockResolvedValue(mockPaginatedResponse),
            findOne: vi.fn().mockResolvedValue(mockProject),
            create: vi.fn().mockResolvedValue(mockProject),
            update: vi.fn().mockResolvedValue(mockProject),
            delete: vi.fn().mockResolvedValue(undefined),
            uploadImage: vi
              .fn()
              .mockResolvedValue({ ...mockProject, hasImage: true }),
            openImage: vi.fn(),
            deleteImage: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get<ProjectsController>(ProjectsController);
    service = module.get<ProjectsService>(ProjectsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('delegates to projectsService.findAll and returns paginated result', async () => {
      const query: ListProjectsQueryDto = {
        limit: 10,
        offset: 0,
        name: 'Test',
      };
      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toBe(mockPaginatedResponse);
    });
  });

  describe('findOne', () => {
    it('delegates to projectsService.findOne and returns project', async () => {
      const result = await controller.findOne(mockProject.id);

      expect(service.findOne).toHaveBeenCalledWith(mockProject.id);
      expect(result).toBe(mockProject);
    });
  });

  describe('create', () => {
    it('creates a project, sets Location header, and returns created project', async () => {
      const dto: CreateProjectDto = {
        name: 'Test Project',
        description: 'A test project description',
      };
      const res = {
        setHeader: vi.fn(),
      } as unknown as Response;

      const result = await controller.create(dto, res);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Location',
        `/api/v1/projects/${mockProject.id}`,
      );
      expect(result).toBe(mockProject);
    });
  });

  describe('update', () => {
    it('delegates to projectsService.update and returns updated project', async () => {
      const dto: UpdateProjectDto = {
        name: 'Updated Project Name',
      };
      const result = await controller.update(mockProject.id, dto);

      expect(service.update).toHaveBeenCalledWith(mockProject.id, dto);
      expect(result).toBe(mockProject);
    });
  });

  describe('delete', () => {
    it('delegates to projectsService.delete and returns void', async () => {
      await controller.delete(mockProject.id);

      expect(service.delete).toHaveBeenCalledWith(mockProject.id);
    });
  });

  describe('uploadImage', () => {
    it('delegates to projectsService.uploadImage and returns updated project with hasImage: true', async () => {
      const mockFile = {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        originalname: 'cover.png',
        mimetype: 'image/png',
        size: 4,
      } as Express.Multer.File;

      const result = await controller.uploadImage(mockProject.id, mockFile);

      expect(service.uploadImage).toHaveBeenCalledWith(mockProject.id, mockFile);
      expect(result).toEqual({ ...mockProject, hasImage: true });
    });

    it('throws BadRequestException if no file is uploaded or buffer is empty', async () => {
      await expect(
        controller.uploadImage(mockProject.id, undefined),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.uploadImage(mockProject.id, {
          buffer: Buffer.alloc(0),
        } as Express.Multer.File),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findImage', () => {
    const etag = '"2026-09-21T09:30:52.000Z-4"';

    function mockRes() {
      return {
        setHeader: vi.fn(),
        status: vi.fn(),
      } as unknown as Response;
    }

    beforeEach(() => {
      vi.mocked(service.openImage).mockResolvedValue({
        contentType: 'image/png',
        size: 4,
        etag,
        open: vi.fn().mockResolvedValue(Readable.from([Buffer.from('png!')])),
      });
    });

    it('sets the validators and streams the image', async () => {
      const res = mockRes();
      const req = { headers: {} } as Request;

      const result = await controller.findImage(mockProject.id, req, res);

      expect(service.openImage).toHaveBeenCalledWith(mockProject.id);
      expect(res.setHeader).toHaveBeenCalledWith('ETag', etag);
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff',
      );
      expect(result).toBeInstanceOf(StreamableFile);
      expect(result?.getHeaders()).toMatchObject({
        type: 'image/png',
        length: 4,
        disposition: 'inline',
      });
    });

    it('answers a matching If-None-Match with 304 and no body', async () => {
      const res = mockRes();
      const req = { headers: { 'if-none-match': etag } } as Request;

      const result = await controller.findImage(mockProject.id, req, res);

      expect(res.status).toHaveBeenCalledWith(304);
      expect(res.setHeader).toHaveBeenCalledWith('ETag', etag);
      expect(result).toBeUndefined();
    });
  });

  describe('deleteImage', () => {
    it('delegates to projectsService.deleteImage', async () => {
      await controller.deleteImage(mockProject.id);

      expect(service.deleteImage).toHaveBeenCalledWith(mockProject.id);
    });
  });
});
