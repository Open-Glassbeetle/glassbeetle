import {
  Body,
  Controller,
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
   * `POST /chats/:chatId/completions` — execute non-streaming completion.
   *
   * Assembles chat history and agent system prompts, invokes the upstream provider
   * adapter, atomically assigns sequence to the assistant response, advances chat
   * updated_at, and records token usage metrics.
   */
  @Post('completions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate chat completion (non-streaming)',
    description:
      'Assembles context for the chat, invokes the configured agent model via provider adapter, ' +
      'persists the assistant reply in conversation order, advances updated_at, and records token usage.',
  })
  @ApiParam({
    name: 'chatId',
    type: String,
    description: 'Unique identifier of the chat to complete.',
  })
  @ApiOkResponse({
    type: CompletionResponseDto,
    description: 'Completion succeeded and assistant message was persisted.',
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
    description: 'Upstream provider authentication, authorization, or network failure.',
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
  ): Promise<CompletionResponseDto> {
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
}
