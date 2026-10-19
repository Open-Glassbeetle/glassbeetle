import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: HealthService;

  beforeEach(async () => {
    const mockHealthService = {
      getHealth: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: mockHealthService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthService = module.get<HealthService>(HealthService);
  });

  it('returns health payload without altering status code when healthy', async () => {
    const healthyPayload = {
      status: 'ok' as const,
      service: 'glassbeetle-api',
      uptimeSeconds: 10,
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: 'up' as const },
        storage: { status: 'up' as const },
      },
    };

    vi.spyOn(healthService, 'getHealth').mockResolvedValue(healthyPayload);

    const mockRes = {
      status: vi.fn(),
    } as unknown as Response;

    const result = await controller.getHealth(mockRes);

    expect(result).toBe(healthyPayload);
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('sets status to 503 when service is degraded', async () => {
    const degradedPayload = {
      status: 'degraded' as const,
      service: 'glassbeetle-api',
      uptimeSeconds: 10,
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: 'down' as const, error: 'DB down' },
        storage: { status: 'up' as const },
      },
    };

    vi.spyOn(healthService, 'getHealth').mockResolvedValue(degradedPayload);

    const mockRes = {
      status: vi.fn(),
    } as unknown as Response;

    const result = await controller.getHealth(mockRes);

    expect(result).toBe(degradedPayload);
    expect(mockRes.status).toHaveBeenCalledWith(503);
  });
});
