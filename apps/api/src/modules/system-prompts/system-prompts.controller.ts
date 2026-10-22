import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import {
  CreateSystemPromptDto,
  ListSystemPromptsQueryDto,
  SystemPromptResponseDto,
  UpdateSystemPromptDto,
} from './dto/index.js';
import { SystemPromptsService } from './system-prompts.service.js';

/**
 * Controller exposing REST CRUD endpoints for system prompt templates.
 *
 * Routes:
 * - `GET /api/v1/system-prompts`: List system prompts with pagination, sorting and filter.
 * - `POST /api/v1/system-prompts`: Create a new system prompt template.
 * - `GET /api/v1/system-prompts/:promptId`: Retrieve a single system prompt template.
 * - `PATCH /api/v1/system-prompts/:promptId`: Partially update an existing system prompt template.
 * - `DELETE /api/v1/system-prompts/:promptId`: Permanently delete a system prompt template.
 */
@ApiTags('system-prompts')
@Controller('system-prompts')
export class SystemPromptsController {
  constructor(private readonly systemPromptsService: SystemPromptsService) {}

  /**
   * `GET /system-prompts` — paginated list, filterable by name.
   */
  @Get()
  async findAll(
    @Query() query: ListSystemPromptsQueryDto,
  ): Promise<PaginatedResponse<SystemPromptResponseDto>> {
    return this.systemPromptsService.findAll(query);
  }

  /**
   * `GET /system-prompts/:promptId` — one prompt with its content.
   */
  @Get(':promptId')
  async findOne(
    @Param('promptId') promptId: string,
  ): Promise<SystemPromptResponseDto> {
    return this.systemPromptsService.findOne(promptId);
  }

  /**
   * `POST /system-prompts` — create a prompt template.
   *
   * Sets the `Location` header, which is why it takes the response object.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateSystemPromptDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SystemPromptResponseDto> {
    const created = await this.systemPromptsService.create(dto);
    res.setHeader('Location', `/api/v1/system-prompts/${created.id}`);
    return created;
  }

  /**
   * `PATCH /system-prompts/:promptId` — change the name or the content.
   *
   * Agents referencing the prompt see the new content immediately; a template
   * is shared by reference, not copied into the agents that use it.
   */
  @Patch(':promptId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('promptId') promptId: string,
    @Body() dto: UpdateSystemPromptDto,
  ): Promise<SystemPromptResponseDto> {
    return this.systemPromptsService.update(promptId, dto);
  }

  /**
   * `DELETE /system-prompts/:promptId` — delete a prompt template.
   *
   * Referencing agents survive with `systemPromptId` cleared to `null`, since
   * the schema declares `ON DELETE SET NULL`. Deleting a prompt therefore
   * changes how those agents are configured without telling the client which
   * ones were affected.
   */
  @Delete(':promptId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('promptId') promptId: string): Promise<void> {
    await this.systemPromptsService.delete(promptId);
  }
}
