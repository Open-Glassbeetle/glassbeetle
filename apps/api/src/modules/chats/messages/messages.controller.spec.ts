import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import type { MessageResponseDto } from './dto/message-response.dto.js';

const MESSAGE: MessageResponseDto = {
  id: '018f3a9e-0000-7000-8000-000000000001',
  chatId: '018f3a9e-0000-7000-8000-000000000002',
  sequence: 1,
  role: 'user',
  agentId: null,
  content: 'Hello, world!',
  status: 'complete',
  tokenCount: 5,
  createdAt: '2026-10-18T00:00:00.000Z',
};

describe('MessagesController', () => {
  let controller: MessagesController;
  let service: MessagesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        {
          provide: MessagesService,
          useValue: {
            findAll: vi.fn().mockResolvedValue({
              items: [MESSAGE],
              total: 1,
              limit: 50,
              offset: 0,
            }),
          },
        },
      ],
    }).compile();

    controller = module.get(MessagesController);
    service = module.get(MessagesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findAll passing chatId and query through to MessagesService', async () => {
    const query = {
      limit: 10,
      offset: 0,
      role: 'user' as const,
      status: 'complete' as const,
      order: 'asc' as const,
      after: 0,
    };

    const result = await controller.findAll('chat-123', query);

    expect(service.findAll).toHaveBeenCalledWith('chat-123', query);
    expect(result).toEqual({
      items: [MESSAGE],
      total: 1,
      limit: 50,
      offset: 0,
    });
  });
});
