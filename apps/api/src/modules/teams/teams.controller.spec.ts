import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamResponseDto } from './dto/team-response.dto.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

const TEAM: TeamResponseDto = {
  id: '018f3a9e-0000-7000-8000-000000000001',
  name: 'Research Desk',
  description: null,
  memberCount: 2,
  createdAt: '2026-10-04T12:00:00.000Z',
  updatedAt: '2026-10-04T12:00:00.000Z',
};

describe('TeamsController', () => {
  let controller: TeamsController;
  let service: TeamsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeamsController],
      providers: [
        {
          provide: TeamsService,
          useValue: {
            findAll: vi
              .fn()
              .mockResolvedValue({
                items: [TEAM],
                total: 1,
                limit: 50,
                offset: 0,
              }),
            findOne: vi.fn().mockResolvedValue(TEAM),
            create: vi.fn().mockResolvedValue(TEAM),
            update: vi.fn().mockResolvedValue(TEAM),
            delete: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get(TeamsController);
    service = module.get(TeamsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates the list, passing the query through', async () => {
    await controller.findAll({ limit: 10, offset: 0, search: 'desk' });

    expect(service.findAll).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
      search: 'desk',
    });
  });

  it('delegates the read', async () => {
    await expect(controller.findOne(TEAM.id)).resolves.toBe(TEAM);
    expect(service.findOne).toHaveBeenCalledWith(TEAM.id);
  });

  it('creates a team and points at it with a Location header', async () => {
    const res = { setHeader: vi.fn() } as unknown as Response;

    await controller.create({ name: 'Research Desk' }, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Location',
      `/api/v1/teams/${TEAM.id}`,
    );
  });

  it('delegates the update', async () => {
    await controller.update(TEAM.id, { name: 'Renamed' });

    expect(service.update).toHaveBeenCalledWith(TEAM.id, { name: 'Renamed' });
  });

  it('delegates the delete', async () => {
    await expect(controller.delete(TEAM.id)).resolves.toBeUndefined();
    expect(service.delete).toHaveBeenCalledWith(TEAM.id);
  });
});
