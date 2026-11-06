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
import { ParseUuidV7Pipe } from '../../../common/identifiers/index.js';
import { ApiErrorResponseDto } from '../../../common/http/api-error.js';
import { InferenceService } from '../../inference/inference.service.js';
import {
  CompactChatDto,
  CompactChatResponseDto,
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
    description:
      'chatId is not a UUIDv7 (INVALID_IDENTIFIER), or invalid overrides supplied in request body.',
  })
  @ApiNotFoundResponse({
    type: ApiErrorResponseDto,
    description: 'Chat does not exist.',
  })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponseDto,
    description:
      'Chat is not runnable (team has no members, no agent, agent missing model, disabled model/provider, or missing credential).',
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
    @Param('chatId', ParseUuidV7Pipe) chatId: string,
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
        return await this.inferenceService.completeChat(chatId, dto ?? {}, {
          signal: abortController.signal,
        });
      } finally {
        req.off('close', onClose);
        res.off('close', onClose);
      }
    }

    let headersSent = false;
    try {
      const stream = this.inferenceService.streamChat(chatId, dto ?? {}, {
        signal: abortController.signal,
      });

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

        if (res.writableEnded || res.destroyed) {
          break;
        }

        const formatted = formatSseEvent(event);
        const canContinue = res.write(formatted);
        if (!canContinue && !res.writableEnded && !res.destroyed) {
          // A client that hangs up while we wait for drain never emits 'drain', so also wake on 'close'
          await new Promise<void>((resolve) => {
            const wake = () => {
              res.off('drain', wake);
              res.off('close', wake);
              resolve();
            };
            res.on('drain', wake);
            res.on('close', wake);
          });
        }
      }
    } finally {
      req.off('close', onClose);
      res.off('close', onClose);
      if (headersSent && !res.writableEnded && !res.destroyed) {
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
  inspectContext(@Param('chatId', ParseUuidV7Pipe) chatId: string) {
    return this.inferenceService.inspectContext(chatId);
  }

  /**
   * `POST /chats/:chatId/compact` — compact conversation history into context summary.
   *
   * Summarises conversation history into `chats.context_summary` so a long conversation
   * can continue without exceeding the model's context window.
   *
   * ### Retention Policy:
   * Summarised messages are **retained** in the database in full. Compaction is a
   * context-window optimisation, not a data-retention policy. A user does not lose their
   * conversation history to make a model call fit: messages remain permanently readable
   * through `GET /chats/:chatId/messages`.
   *
   * ### Compaction Point Tracking:
   * The compaction boundary is tracked via `chats.compacted_before_sequence`, recording
   * the exact sequence up to which messages were summarised. Context construction uses
   * this sequence to prune superseded turns from the model prompt, preventing duplicate
   * messages and ensuring no messages arriving during or after compaction are lost.
   *
   * ### Recent History Preservation:
   * Recent history is preserved uncompacted (default: 2 messages, overridable via
   * `preserveRecentCount`). Preserving immediate turns maintains conversational continuity.
   *
   * ### Repeated Compaction:
   * Compacting an already-compacted chat folds the previous `context_summary` together with
   * newer turns into an updated unified summary rather than discarding prior history.
   */
  @Post('compact')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Compact conversation history into a context summary',
    description:
      'Summarises conversation history into chats.context_summary so long conversations ' +
      'can continue without exceeding model context limits. Retains existing messages in the database ' +
      'so full conversation history remains readable, while tracking the compaction point so context ' +
      'construction includes each message exactly once. Folds prior summary into new summary on repeated compactions.',
  })
  @ApiParam({
    name: 'chatId',
    type: String,
    description: 'Unique identifier of the chat to compact.',
  })
  @ApiOkResponse({
    type: CompactChatResponseDto,
    description:
      'Compaction succeeded. Returns updated chat representation and compaction coverage metrics.',
  })
  @ApiBadRequestResponse({
    type: ApiErrorResponseDto,
    description:
      'Invalid options supplied in request body (e.g. negative preserveRecentCount or no messages eligible to compact).',
  })
  @ApiNotFoundResponse({
    type: ApiErrorResponseDto,
    description: 'Chat does not exist.',
  })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponseDto,
    description:
      'Chat is not runnable (team has no members, no agent, agent missing model, disabled model/provider, or missing credential).',
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
  async compactChat(
    @Param('chatId', ParseUuidV7Pipe) chatId: string,
    @Body() dto: CompactChatDto | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CompactChatResponseDto> {
    const abortController = new AbortController();

    const reqWithSignal = req as { signal?: AbortSignal };
    if (reqWithSignal?.signal) {
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

    const onClose = () => {
      if (!res.writableEnded && !abortController.signal.aborted) {
        abortController.abort(new Error('Client disconnected'));
      }
    };

    req?.on?.('close', onClose);
    res?.on?.('close', onClose);

    try {
      return await this.inferenceService.compactChat(chatId, dto, {
        signal: abortController.signal,
      });
    } finally {
      req?.off?.('close', onClose);
      res?.off?.('close', onClose);
    }
  }
}
