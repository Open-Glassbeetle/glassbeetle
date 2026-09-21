import { Test, TestingModule } from '@nestjs/testing';
import { ProviderModelsController } from './provider-models.controller.js';

describe('ProviderModelsController', () => {
  let controller: ProviderModelsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProviderModelsController],
    }).compile();

    controller = module.get<ProviderModelsController>(ProviderModelsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
