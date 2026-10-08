import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetController } from './budget.controller.js';
import { BudgetService } from './budget.service.js';
import type { BudgetResponseDto } from './dto/budget-response.dto.js';

const BUDGET: BudgetResponseDto = {
  id: '018f3a9e-0000-7000-8000-000000000001',
  limitUsd: 20,
  period: 'monthly',
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  spentUsd: 4.12,
  remainingUsd: 15.88,
  usedFraction: 0.206,
  callCount: 37,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-08T14:22:10.904Z',
};

describe('BudgetController', () => {
  let controller: BudgetController;
  let service: BudgetService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BudgetController],
      providers: [
        {
          provide: BudgetService,
          useValue: {
            find: vi.fn().mockResolvedValue(BUDGET),
            update: vi.fn().mockResolvedValue(BUDGET),
          },
        },
      ],
    }).compile();

    controller = module.get(BudgetController);
    service = module.get(BudgetService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates the read to the service', async () => {
    await expect(controller.find()).resolves.toBe(BUDGET);
    expect(service.find).toHaveBeenCalledOnce();
  });

  it('delegates the update to the service', async () => {
    await expect(controller.update({ limitUsd: 50 })).resolves.toBe(BUDGET);
    expect(service.update).toHaveBeenCalledWith({ limitUsd: 50 });
  });
});
