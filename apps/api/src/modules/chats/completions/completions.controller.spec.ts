import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { CompletionsController } from './completions.controller.js';
import { InferenceService } from '../../inference/inference.service.js';
import type { CreateCompletionDto, CompletionResponseDto } from './dto/index.js';

describe('CompletionsController', () => {
  let controller: CompletionsController;
  let mockInferenceService: {
    completeChat: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockInferenceService = {
      completeChat: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompletionsController],
      providers: [
        {
          provide: InferenceService,
          useValue: mockInferenceService,
        },
      ],
    }).compile();

    controller = module.get<CompletionsController>(CompletionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createCompletion', () => {
    it('delegates to inferenceService with chatId, dto, and AbortSignal', async () => {
      const chatId = 'chat-001';
      const dto: CreateCompletionDto = {
        temperature: 0.7,
        maxTokens: 500,
      };

      const mockResult: CompletionResponseDto = {
        id: 'msg-001',
        chatId,
        sequence: 2,
        role: 'assistant',
        content: 'Hello, I am your agent.',
        reasoningContent: null,
        agentId: 'agent-001',
        status: 'complete',
        tokenCount: 42,
        finishReason: 'stop',
        createdAt: '2026-10-15T12:00:00.000Z',
        updatedAt: '2026-10-15T12:00:00.000Z',
        usage: {
          inputTokens: 20,
          outputTokens: 22,
          totalTokens: 42,
        },
      };

      mockInferenceService.completeChat.mockResolvedValueOnce(mockResult);

      const req = new EventEmitter() as unknown as Request;
      const res = new EventEmitter() as unknown as Response;
      (res as unknown as { writableEnded: boolean }).writableEnded = false;

      const result = await controller.createCompletion(chatId, dto, req, res);

      expect(result).toBe(mockResult);
      expect(mockInferenceService.completeChat).toHaveBeenCalledWith(
        chatId,
        dto,
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('propagates pre-aborted signal from req', async () => {
      const chatId = 'chat-001';
      const dto: CreateCompletionDto = {};

      const ac = new AbortController();
      ac.abort(new Error('Pre-aborted'));

      mockInferenceService.completeChat.mockImplementation(
        async (_chatId, _dto, options) => {
          expect(options.signal?.aborted).toBe(true);
          throw new Error('Aborted');
        },
      );

      const req = new EventEmitter() as unknown as Request;
      (req as unknown as { signal: AbortSignal }).signal = ac.signal;
      const res = new EventEmitter() as unknown as Response;

      await expect(
        controller.createCompletion(chatId, dto, req, res),
      ).rejects.toThrow('Aborted');
    });

    it('aborts signal on premature client close', async () => {
      const chatId = 'chat-001';
      const dto: CreateCompletionDto = {};

      let capturedSignal: AbortSignal | undefined;
      mockInferenceService.completeChat.mockImplementation(
        async (_chatId, _dto, options) => {
          capturedSignal = options.signal;
          return new Promise((resolve) => setTimeout(resolve, 50));
        },
      );

      const req = new EventEmitter() as unknown as Request;
      const res = new EventEmitter() as unknown as Response;
      (res as unknown as { writableEnded: boolean }).writableEnded = false;

      const promise = controller.createCompletion(chatId, dto, req, res);

      // Premature disconnect before res.writableEnded becomes true
      req.emit('close');

      expect(capturedSignal?.aborted).toBe(true);
      await promise;
    });
  });
});
