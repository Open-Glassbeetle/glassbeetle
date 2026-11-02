import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponseDto } from '../../../common/http/api-error.js';
import { InferenceService } from '../../inference/inference.service.js';
import {
  CompletionResponseDto,
  CreateCompletionDto,
  formatSseEvent,
} from './dto/index.js';

/**
 * Exposes chat completion endpoints.
 * Mounted at `/api/v1/chats/:chatId` with method path `completions`.
 *
 * Scoped by `:chatId` so completions and future compaction share the chat context.
 * Marked with `@ApiTags('chats')` so chat management, messages, and completions
 * appear grouped in OpenAPI documentation.
 */
@ApiTags('chats')
@Controller('chats/:chatId')
export class CompletionsController {
  constructor(private readonly inferenceService: InferenceService) {}

  /**
   * `POST /chats/:chatId/completions` — execute streaming or non-streaming chat completion.
   *
   * Assembles chat history and agent system prompts, invokes the upstream provider
   * adapter, atomically assigns sequence to the assistant response, advances chat
   * updated_at, and records token usage metrics.
   *
   * Streaming vs non-streaming is determined by the request:
   * - Setting `"stream": true` in the request body (or sending `Accept: text/event-stream`)
   *   streams incremental events over Server-Sent Events (SSE).
   * - Otherwise, returns the complete persisted assistant reply as a JSON object.
   */
  @Post('completions')
  @HttpCode(HttpStatus.OK)
  @ApiProduces('application/json', 'text/event-stream')
  @ApiOperation({
    summary: 'Generate chat completion (streaming or non-streaming)',
    description:
      'Assembles context for the chat, invokes the configured agent model via provider adapter, ' +
      'persists the assistant reply in conversation order, advances updated_at, and records token usage. ' +
      'Clients request streaming by setting "stream": true in the request body or sending "Accept: text/event-stream".',
  })
  @ApiParam({
    name: 'chatId',
    type: String,
    description: 'Unique identifier of the chat to complete.',
  })
  @ApiOkResponse({
    type: CompletionResponseDto,
    description:
      'Completion succeeded. Returns persisted assistant message for non-streaming completions, ' +
      'or streams Server-Sent Events (SSE) when stream=true or Accept: text/event-stream is requested.',
  })
  @ApiBadRequestResponse({
    type: ApiErrorResponseDto,
    description: 'Invalid overrides supplied in request body.',
  })
  @ApiNotFoundResponse({
    type: ApiErrorResponseDto,
    description: 'Chat does not exist.',
  })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponseDto,
    description:
      'Chat is not runnable (team chat, no agent, agent missing model, disabled model/provider, or missing credential).',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    type: ApiErrorResponseDto,
    description: 'Upstream rate limit exceeded.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    type: ApiErrorResponseDto,
    description:
      'Upstream provider authentication, authorization, or network failure.',
  })
  @ApiResponse({
    status: HttpStatus.GATEWAY_TIMEOUT,
    type: ApiErrorResponseDto,
    description: 'Upstream provider request timed out.',
  })
  async createCompletion(
    @Param('chatId') chatId: string,
    @Body() dto: CreateCompletionDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CompletionResponseDto | void> {
    const abortController = new AbortController();

    // Propagate existing AbortSignal if present on the request (e.g. from tests or middleware)
    const reqWithSignal = req as { signal?: AbortSignal };
    if (reqWithSignal.signal) {
      if (reqWithSignal.signal.aborted) {
        abortController.abort(reqWithSignal.signal.reason);
      } else {
        reqWithSignal.signal.addEventListener(
          'abort',
          () => abortController.abort(reqWithSignal.signal?.reason),
          { once: true },
        );
      }
    }

    // Cancel in-flight model invocation if the client closes the connection prematurely
    const onClose = () => {
      if (!res.writableEnded && !abortController.signal.aborted) {
        abortController.abort(new Error('Client disconnected'));
      }
    };

    req.on('close', onClose);
    res.on('close', onClose);

    const isStreaming =
      dto?.stream === true ||
      Boolean(req?.headers?.accept?.includes('text/event-stream'));


    if (!isStreaming) {
      try {
        return await this.inferenceService.completeChat(
          chatId,
          dto ?? {},
          { signal: abortController.signal },
        );
      } finally {
        req.off('close', onClose);
        res.off('close', onClose);
      }
    }

    let headersSent = false;
    try {
      const stream = this.inferenceService.streamChat(
        chatId,
        dto ?? {},
        { signal: abortController.signal },
      );

      for await (const event of stream) {
        if (!headersSent) {
          res.status(HttpStatus.OK);
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders?.();
          headersSent = true;
        }

        if (res.writableEnded) {
          break;
        }

        const formatted = formatSseEvent(event);
        const canContinue = res.write(formatted);
        if (!canContinue && !res.writableEnded) {
          await new Promise<void>((resolve) => {
            res.once('drain', resolve);
          });
        }
      }
    } finally {
      req.off('close', onClose);
      res.off('close', onClose);
      if (headersSent && !res.writableEnded) {
        res.end();
      }
    }
  }

  /**
   * `GET /chats/:chatId/context` & `GET /chats/:chatId/completions/context`
   *
   * Inspects the constructed conversation context without invoking upstream model providers.
   * Exposes system prompt layers, filtered message history, token estimations, and window fitting metadata.
   */
  @Get(['context', 'completions/context'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inspect assembled conversation context',
    description:
      'Assembles and returns the full conversation context that would be sent to the model, ' +
      'including system prompt breakdown, personality, instructions, context summary, ' +
      'message history filtering, and token estimation without executing completion.',
  })
  @ApiParam({ name: 'chatId', description: 'Chat identifier' })
  @ApiOkResponse({
    description: 'Assembled context for inspection and debugging',
  })
  @ApiNotFoundResponse({
    type: ApiErrorResponseDto,
    description: 'Chat or assigned agent not found',
  })
  inspectContext(@Param('chatId') chatId: string) {
    return this.inferenceService.inspectContext(chatId);
  }
}

