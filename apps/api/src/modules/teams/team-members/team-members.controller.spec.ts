import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamMemberResponseDto } from './dto/team-member-response.dto.js';
import { TeamMembersController } from './team-members.controller.js';
import { TeamMembersService } from './team-members.service.js';

const TEAM_ID = '018f3a9e-0000-7000-8000-000000000001';
const AGENT_ID = '018f3a9e-0000-7000-8000-000000000002';

const MEMBER: TeamMemberResponseDto = {
  teamId: TEAM_ID,
  agentId: AGENT_ID,
  role: 'Supervisor',
  position: 0,
  createdAt: '2026-10-04T12:00:00.000Z',
};

describe('TeamMembersController', () => {
  let controller: TeamMembersController;
  let service: TeamMembersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeamMembersController],
      providers: [
        {
          provide: TeamMembersService,
          useValue: {
            findAll: vi
              .fn()
              .mockResolvedValue({
                items: [MEMBER],
                total: 1,
                limit: 50,
                offset: 0,
              }),
            findOne: vi.fn().mockResolvedValue(MEMBER),
            add: vi.fn().mockResolvedValue(MEMBER),
            update: vi.fn().mockResolvedValue(MEMBER),
            remove: vi.fn().mockResolvedValue(undefined),
            reorder: vi
              .fn()
              .mockResolvedValue({
                items: [MEMBER],
                total: 1,
                limit: 100,
                offset: 0,
              }),
          },
        },
      ],
    }).compile();

    controller = module.get(TeamMembersController);
    service = module.get(TeamMembersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('scopes the list to the team in the URL', async () => {
    await controller.findAll(TEAM_ID, { limit: 50, offset: 0 });

    expect(service.findAll).toHaveBeenCalledWith(TEAM_ID, {
      limit: 50,
      offset: 0,
    });
  });

  it('scopes the read to the team in the URL', async () => {
    await controller.findOne(TEAM_ID, AGENT_ID);

    expect(service.findOne).toHaveBeenCalledWith(TEAM_ID, AGENT_ID);
  });

  it('adds an agent and points at the membership with a Location header', async () => {
    const res = { setHeader: vi.fn() } as unknown as Response;

    await controller.add(TEAM_ID, { agentId: AGENT_ID }, res);

    expect(service.add).toHaveBeenCalledWith(TEAM_ID, { agentId: AGENT_ID });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Location',
      `/api/v1/teams/${TEAM_ID}/members/${AGENT_ID}`,
    );
  });

  it('delegates the role change', async () => {
    await controller.update(TEAM_ID, AGENT_ID, { role: 'Researcher' });

    expect(service.update).toHaveBeenCalledWith(TEAM_ID, AGENT_ID, {
      role: 'Researcher',
    });
  });

  it('delegates the removal', async () => {
    await expect(controller.remove(TEAM_ID, AGENT_ID)).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith(TEAM_ID, AGENT_ID);
  });

  it('delegates the reorder', async () => {
    await controller.reorder(TEAM_ID, { agentIds: [AGENT_ID] });

    expect(service.reorder).toHaveBeenCalledWith(TEAM_ID, {
      agentIds: [AGENT_ID],
    });
  });
});
