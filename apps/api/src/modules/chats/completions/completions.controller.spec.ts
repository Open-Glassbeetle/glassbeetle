import { Test, TestingModule } from '@nestjs/testing';
import { CompletionsController } from './completions.controller';

describe('CompletionsController', () => {
  let controller: CompletionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompletionsController],
    }).compile();

    controller = module.get<CompletionsController>(CompletionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
