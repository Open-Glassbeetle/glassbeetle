import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import type { ActivityQueryDto } from './dto/activity-query.dto.js';
import type { ActivityResponseDto } from './dto/activity-response.dto.js';
import type { UsageQueryDto } from './dto/usage-query.dto.js';
import type { UsageResponseDto } from './dto/usage-response.dto.js';

const MOCK_USAGE_RESPONSE: UsageResponseDto = {
  timeRange: {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-31T23:59:59.999Z',
  },
  timeZone: 'UTC',
  totals: {
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    costUsd: 0.05,
    eventCount: 10,
    unknownTokensEventCount: 1,
    unknownCostEventCount: 0,
  },
  groups: [
    {
      bucket: '2026-10-01',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.05,
      eventCount: 10,
      unknownTokensEventCount: 1,
      unknownCostEventCount: 0,
    },
  ],
};

const MOCK_ACTIVITY_RESPONSE: ActivityResponseDto = {
  timeRange: {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-31T23:59:59.999Z',
  },
  timeZone: 'UTC',
  interval: 'day',
  totals: {
    totalCount: 12,
    byEventType: {
      chat_completion: 10,
      chat_compaction: 1,
      agent_created: 1,
      artifact_created: 0,
    },
  },
  series: [
    {
      bucket: '2026-10-01',
      totalCount: 12,
      byEventType: {
        chat_completion: 10,
        chat_compaction: 1,
        agent_created: 1,
        artifact_created: 0,
      },
    },
  ],
};

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: AnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        {
          provide: AnalyticsService,
          useValue: {
            getUsage: vi.fn().mockResolvedValue(MOCK_USAGE_RESPONSE),
            getActivity: vi.fn().mockResolvedValue(MOCK_ACTIVITY_RESPONSE),
          },
        },
      ],
    }).compile();

    controller = module.get(AnalyticsController);
    service = module.get(AnalyticsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates GET /usage to AnalyticsService.getUsage with provided query parameters', async () => {
    const query: UsageQueryDto = {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T23:59:59.999Z',
      groupBy: ['day'],
      agentId: 'agent-123',
    };

    const result = await controller.getUsage(query);

    expect(result).toBe(MOCK_USAGE_RESPONSE);
    expect(service.getUsage).toHaveBeenCalledOnce();
    expect(service.getUsage).toHaveBeenCalledWith(query);
  });

  it('delegates GET /activity to AnalyticsService.getActivity with provided query parameters', async () => {
    const query: ActivityQueryDto = {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T23:59:59.999Z',
      interval: 'hour',
      agentId: 'agent-123',
    };

    const result = await controller.getActivity(query);

    expect(result).toBe(MOCK_ACTIVITY_RESPONSE);
    expect(service.getActivity).toHaveBeenCalledOnce();
    expect(service.getActivity).toHaveBeenCalledWith(query);
  });
});
