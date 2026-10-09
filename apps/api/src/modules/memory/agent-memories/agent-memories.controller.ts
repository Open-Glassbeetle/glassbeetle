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
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponseDto } from '../../../common/http/api-error.js';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import { AgentMemoriesService } from './agent-memories.service.js';
import {
  AgentMemoryResponseDto,
  BulkDeleteQueryDto,
  BulkDeleteResponseDto,
  CreateAgentMemoryDto,
  ListAgentMemoriesQueryDto,
  UpdateAgentMemoryDto,
} from './dto/index.js';

/**
 * Controller exposing collection endpoints for an agent's private memory.
 *
 * Endpoints:
 * - `GET /api/v1/agents/:agentId/memories`: Lists private memories of the specified agent.
 * - `POST /api/v1/agents/:agentId/memories`: Appends a new private memory to the agent.
 * - `DELETE /api/v1/agents/:agentId/memories`: Clears an agent's private memories (requires ?confirm=true).
 * - `GET /api/v1/agents/:agentId/memories/:memoryId`: Retrieves a single private memory.
 * - `PATCH /api/v1/agents/:agentId/memories/:memoryId`: Updates a private memory.
 * - `DELETE /api/v1/agents/:agentId/memories/:memoryId`: Deletes a single private memory.
 */
@ApiTags('agent-memories')
@Controller('agents/:agentId/memories')
export class AgentMemoriesController {
  constructor(private readonly agentMemoriesService: AgentMemoriesService) {}

  @Get()
  async findAll(
    @Param('agentId') agentId: string,
    @Query() query: ListAgentMemoriesQueryDto,
  ): Promise<PaginatedResponse<AgentMemoryResponseDto>> {
    return this.agentMemoriesService.findAll(agentId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('agentId') agentId: string,
    @Body() dto: CreateAgentMemoryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgentMemoryResponseDto> {
    const created = await this.agentMemoriesService.create(agentId, dto);
    res.setHeader(
      'Location',
      `/api/v1/agents/${agentId}/memories/${created.id}`,
    );
    return created;
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Clear an agent's private memories",
    description:
      'Permanently and irreversibly deletes all private memories belonging to the specified agent. This operation cannot be undone. Requires explicit confirmation via the `?confirm=true` query parameter.',
  })
  @ApiParam({
    name: 'agentId',
    description: 'Unique agent identifier',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiQuery({
    name: 'confirm',
    description:
      'Safety confirmation parameter. Must be set to "true" to authorize irreversible deletion.',
    required: true,
    type: String,
    example: 'true',
  })
  @ApiOkResponse({
    description: "Agent's private memories successfully cleared",
    type: BulkDeleteResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Missing or invalid confirmation parameter',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No agent found with that ID',
    type: ApiErrorResponseDto,
  })
  async removeAll(
    @Param('agentId') agentId: string,
    @Query() _query: BulkDeleteQueryDto,
  ): Promise<BulkDeleteResponseDto> {
    return this.agentMemoriesService.removeAll(agentId);
  }

  @Get(':memoryId')
  async findOne(
    @Param('agentId') agentId: string,
    @Param('memoryId') memoryId: string,
  ): Promise<AgentMemoryResponseDto> {
    return this.agentMemoriesService.findOne(agentId, memoryId);
  }

  @Patch(':memoryId')
  async update(
    @Param('agentId') agentId: string,
    @Param('memoryId') memoryId: string,
    @Body() dto: UpdateAgentMemoryDto,
  ): Promise<AgentMemoryResponseDto> {
    return this.agentMemoriesService.update(agentId, memoryId, dto);
  }

  @Delete(':memoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('agentId') agentId: string,
    @Param('memoryId') memoryId: string,
  ): Promise<void> {
    await this.agentMemoriesService.remove(agentId, memoryId);
  }
}
