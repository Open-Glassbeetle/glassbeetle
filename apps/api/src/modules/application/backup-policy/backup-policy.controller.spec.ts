import { Test, TestingModule } from '@nestjs/testing';
import { BackupPolicyController } from './backup-policy.controller';

describe('BackupPolicyController', () => {
  let controller: BackupPolicyController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BackupPolicyController],
    }).compile();

    controller = module.get<BackupPolicyController>(BackupPolicyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
