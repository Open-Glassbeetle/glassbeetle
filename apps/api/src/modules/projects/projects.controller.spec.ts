import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
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
});
