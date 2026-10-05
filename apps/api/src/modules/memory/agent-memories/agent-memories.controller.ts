import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import { AgentMemoriesService } from './agent-memories.service.js';
import {
  AgentMemoryResponseDto,
  CreateAgentMemoryDto,
  ListAgentMemoriesQueryDto,
} from './dto/index.js';

/**
 * Controller exposing collection endpoints for an agent's private memory.
 *
 * Endpoints:
 * - `GET /api/v1/agents/:agentId/memories`: Lists private memories of the specified agent.
 * - `POST /api/v1/agents/:agentId/memories`: Appends a new private memory to the agent.
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
}
