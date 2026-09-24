import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  let service: HealthService;
  let dbService: DatabaseService;

  beforeEach(async () => {
    const mockDbService = {
      get: vi.fn().mockReturnValue({ '1': 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: DatabaseService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    dbService = module.get<DatabaseService>(DatabaseService);
  });

  it('returns a healthy response shape when database is reachable', () => {
    const health = service.getHealth();

    expect(health.status).toBe('ok');
    expect(health.service).toBe('glassbeetle-api');
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
    expect(health.checks.database.status).toBe('up');
    expect(dbService.get).toHaveBeenCalledWith('SELECT 1');
  });

  it('increases uptimeSeconds over time', async () => {
    const initialHealth = service.getHealth();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const laterHealth = service.getHealth();

    expect(laterHealth.uptimeSeconds).toBeGreaterThan(
      initialHealth.uptimeSeconds,
    );
  });

  it('returns a degraded status when the database check throws an error', () => {
    vi.spyOn(dbService, 'get').mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    const health = service.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks.database.status).toBe('down');
    expect(health.checks.database.error).toBe('Database connection failed');
  });

  it('returns not_configured when DatabaseService is not available', () => {
    const unconfiguredService = new HealthService(undefined);
    const health = unconfiguredService.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks.database.status).toBe('not_configured');
  });
});
