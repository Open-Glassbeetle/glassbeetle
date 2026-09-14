import { Test, TestingModule } from '@nestjs/testing';
import { AgentMemoriesController } from './agent-memories.controller';

describe('AgentMemoriesController', () => {
  let controller: AgentMemoriesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentMemoriesController],
    }).compile();

    controller = module.get<AgentMemoriesController>(AgentMemoriesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
