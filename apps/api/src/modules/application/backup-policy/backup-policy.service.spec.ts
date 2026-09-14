import { Test, TestingModule } from '@nestjs/testing';
import { BackupPolicyService } from './backup-policy.service';

describe('BackupPolicyService', () => {
  let service: BackupPolicyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BackupPolicyService],
    }).compile();

    service = module.get<BackupPolicyService>(BackupPolicyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
