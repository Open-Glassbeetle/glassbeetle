import { Test, TestingModule } from '@nestjs/testing';
import { SharedMemoriesController } from './shared-memories.controller';

describe('SharedMemoriesController', () => {
  let controller: SharedMemoriesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SharedMemoriesController],
    }).compile();

    controller = module.get<SharedMemoriesController>(SharedMemoriesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
