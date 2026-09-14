import { Test, TestingModule } from '@nestjs/testing';
import { SystemPromptsController } from './system-prompts.controller';

describe('SystemPromptsController', () => {
  let controller: SystemPromptsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemPromptsController],
    }).compile();

    controller = module.get<SystemPromptsController>(SystemPromptsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
