import { Test, TestingModule } from '@nestjs/testing';
import { AdapterFactoryService } from './adapter-factory.service';

describe('AdapterFactoryService', () => {
  let service: AdapterFactoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdapterFactoryService],
    }).compile();

    service = module.get<AdapterFactoryService>(AdapterFactoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
