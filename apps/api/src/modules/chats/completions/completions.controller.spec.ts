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
    inspectContext: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockInferenceService = {
      completeChat: vi.fn(),
      inspectContext: vi.fn(),
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

    it('streams SSE events when dto.stream is true', async () => {
      const chatId = 'chat-001';
      const dto: CreateCompletionDto = { stream: true };

      const mockEvents = [
        {
          type: 'message_start' as const,
          data: {
            messageId: 'msg-001',
            chatId,
            sequence: 2,
            agentId: 'agent-001',
            role: 'assistant' as const,
          },
        },
        {
          type: 'token' as const,
          data: { messageId: 'msg-001', text: 'Hello ' },
        },
        {
          type: 'token' as const,
          data: { messageId: 'msg-001', text: 'world!' },
        },
        {
          type: 'message_complete' as const,
          data: {
            messageId: 'msg-001',
            status: 'complete' as const,
            tokenCount: 2,
          },
        },
        {
          type: 'done' as const,
          data: '[DONE]' as const,
        },
      ];

      async function* mockStream() {
        for (const evt of mockEvents) {
          yield evt;
        }
      }

      (mockInferenceService as any).streamChat = vi.fn().mockReturnValue(mockStream());

      const req = new EventEmitter() as unknown as Request;
      (req as any).headers = {};

      const writtenChunks: string[] = [];
      const headers: Record<string, string> = {};
      const res = new EventEmitter() as unknown as Response;
      (res as any).writableEnded = false;
      (res as any).status = vi.fn().mockReturnValue(res);
      (res as any).setHeader = vi.fn((key: string, val: string) => {
        headers[key] = val;
      });
      (res as any).flushHeaders = vi.fn();
      (res as any).write = vi.fn((chunk: string) => {
        writtenChunks.push(chunk);
        return true;
      });
      (res as any).end = vi.fn(() => {
        (res as any).writableEnded = true;
      });

      await controller.createCompletion(chatId, dto, req, res);

      expect((res as any).setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/event-stream',
      );
      expect((res as any).setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-cache, no-transform',
      );
      expect(writtenChunks).toHaveLength(5);
      expect(writtenChunks[0]).toBe(
        'event: message_start\ndata: {"messageId":"msg-001","chatId":"chat-001","sequence":2,"agentId":"agent-001","role":"assistant"}\n\n',
      );
      expect(writtenChunks[1]).toBe(
        'event: token\ndata: {"messageId":"msg-001","text":"Hello "}\n\n',
      );
      expect(writtenChunks[4]).toBe('event: done\ndata: [DONE]\n\n');
      expect((res as any).end).toHaveBeenCalled();
    });

    it('streams SSE events when Accept header includes text/event-stream', async () => {
      const chatId = 'chat-001';
      const dto: CreateCompletionDto = {};

      async function* mockStream() {
        yield {
          type: 'message_start' as const,
          data: {
            messageId: 'msg-001',
            chatId,
            sequence: 2,
            agentId: 'agent-001',
            role: 'assistant' as const,
          },
        };
        yield {
          type: 'done' as const,
          data: '[DONE]' as const,
        };
      }

      (mockInferenceService as any).streamChat = vi.fn().mockReturnValue(mockStream());

      const req = new EventEmitter() as unknown as Request;
      (req as any).headers = { accept: 'text/event-stream, */*' };

      const res = new EventEmitter() as unknown as Response;
      (res as any).writableEnded = false;
      (res as any).status = vi.fn().mockReturnValue(res);
      (res as any).setHeader = vi.fn();
      (res as any).flushHeaders = vi.fn();
      (res as any).write = vi.fn().mockReturnValue(true);
      (res as any).end = vi.fn(() => {
        (res as any).writableEnded = true;
      });

      await controller.createCompletion(chatId, dto, req, res);

      expect((mockInferenceService as any).streamChat).toHaveBeenCalledWith(
        chatId,
        dto,
        expect.anything(),
      );
      expect((res as any).setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/event-stream',
      );
    });

    it('pauses streaming on backpressure until drain event fires', async () => {
      const chatId = 'chat-001';
      const dto: CreateCompletionDto = { stream: true };

      let drainResolved = false;

      async function* mockStream() {
        yield {
          type: 'token' as const,
          data: { messageId: 'm1', text: 'chunk1' },
        };
        // This second chunk should only be yielded after drain fires
        expect(drainResolved).toBe(true);
        yield {
          type: 'token' as const,
          data: { messageId: 'm1', text: 'chunk2' },
        };
      }

      (mockInferenceService as any).streamChat = vi.fn().mockReturnValue(mockStream());

      const req = new EventEmitter() as unknown as Request;
      (req as any).headers = {};

      const res = new EventEmitter() as unknown as Response;
      (res as any).writableEnded = false;
      (res as any).status = vi.fn().mockReturnValue(res);
      (res as any).setHeader = vi.fn();
      (res as any).flushHeaders = vi.fn();

      let writeCount = 0;
      (res as any).write = vi.fn(() => {
        writeCount++;
        if (writeCount === 1) {
          // Simulate buffer full on first write
          setTimeout(() => {
            drainResolved = true;
            res.emit('drain');
          }, 30);
          return false;
        }
        return true;
      });
      (res as any).end = vi.fn(() => {
        (res as any).writableEnded = true;
      });

      await controller.createCompletion(chatId, dto, req, res);

      expect(writeCount).toBe(2);
      expect((res as any).end).toHaveBeenCalled();
    });
  });

  describe('inspectContext', () => {
    it('delegates to inferenceService.inspectContext with chatId', () => {
      const chatId = 'chat-001';
      const mockAssembled = {
        systemPrompt: 'System',
        messages: [],
      };
      mockInferenceService.inspectContext.mockReturnValue(mockAssembled);

      const result = controller.inspectContext(chatId);

      expect(mockInferenceService.inspectContext).toHaveBeenCalledWith(chatId);
      expect(result).toBe(mockAssembled);
    });
  });
});

