import { Test, TestingModule } from '@nestjs/testing';
import { SystemPromptsService } from './system-prompts.service';

describe('SystemPromptsService', () => {
  let service: SystemPromptsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SystemPromptsService],
    }).compile();

    service = module.get<SystemPromptsService>(SystemPromptsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
