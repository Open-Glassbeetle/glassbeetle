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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import { AgentsService } from './agents.service.js';
import { AgentResponseDto } from './dto/agent-response.dto.js';
import { CreateAgentDto } from './dto/create-agent.dto.js';
import { ListAgentsQueryDto } from './dto/list-agents-query.dto.js';
import { UpdateAgentDto } from './dto/update-agent.dto.js';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List agents',
    description:
      'Retrieves stored agents with pagination, sorting, and filtering.',
  })
  @ApiOkResponse({
    description: 'Paginated list of agents matching query criteria',
    type: AgentResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid pagination, sorting, or filter query parameters',
  })
  async findAll(
    @Query() query: ListAgentsQueryDto,
  ): Promise<PaginatedResponse<AgentResponseDto>> {
    return this.agentsService.findAll(query);
  }

  @Get(':agentId')
  @ApiOperation({
    summary: 'Retrieve an agent',
    description: 'Retrieves a single agent by its unique identifier.',
  })
  @ApiParam({
    name: 'agentId',
    description: 'Unique agent identifier',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiOkResponse({
    description: 'Agent found and returned',
    type: AgentResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No agent found with that ID',
  })
  async findOne(@Param('agentId') agentId: string): Promise<AgentResponseDto> {
    return this.agentsService.findOne(agentId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an agent',
    description:
      'Creates a new agent with server-managed identifiers and timestamps.',
  })
  @ApiCreatedResponse({
    description: 'Agent created successfully',
    type: AgentResponseDto,
    headers: {
      Location: {
        description: 'URI of the newly created agent resource',
        schema: {
          type: 'string',
          example: '/api/v1/agents/018f3a9e-0000-7000-8000-000000000001',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Request validation failed (e.g. missing name, invalid types, or client-supplied server-managed fields)',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Referenced foreign key (modelId or systemPromptId) does not exist',
  })
  async create(
    @Body() dto: CreateAgentDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgentResponseDto> {
    const created = await this.agentsService.create(dto);
    res.setHeader('Location', `/api/v1/agents/${created.id}`);
    return created;
  }

  @Patch(':agentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update an agent',
    description:
      'Applies partial updates to an existing agent resource (PATCH). Only supplied fields are updated.',
  })
  @ApiParam({
    name: 'agentId',
    description: 'Unique agent identifier',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiOkResponse({
    description: 'Agent updated successfully',
    type: AgentResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Request validation failed (e.g. invalid types, out-of-range values, or client-supplied server-managed fields)',
  })
  @ApiNotFoundResponse({
    description: 'No agent found with that ID',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Referenced foreign key (modelId or systemPromptId) does not exist',
  })
  async update(
    @Param('agentId') agentId: string,
    @Body() dto: UpdateAgentDto,
  ): Promise<AgentResponseDto> {
    return this.agentsService.update(agentId, dto);
  }

  @Delete(':agentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an agent',
    description: `Permanently deletes an agent resource and unlinks any stored profile picture file.

Cascade behavior across referencing tables:
- \`agent_memories\` (agent_id NOT NULL): CASCADE — the agent's private memories are destroyed.
- \`team_members\` (agent_id NOT NULL): CASCADE — team memberships are removed.
- \`chats\` (agent_id nullable): SET NULL — chats survive, orphaned (Note: deleting an agent with agent-owned chats violates the chats CHECK constraint; see issue #29).
- \`messages\` (agent_id nullable): SET NULL — messages survive, attribution lost.
- \`artifacts\` (agent_id nullable): SET NULL — artifacts survive, attribution lost.
- \`usage_events\` (agent_id nullable): SET NULL — analytics history survives, attribution lost.`,
  })
  @ApiParam({
    name: 'agentId',
    description: 'Unique agent identifier',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiNoContentResponse({
    description: 'Agent successfully deleted',
  })
  @ApiNotFoundResponse({
    description: 'No agent found with that ID',
  })
  async delete(@Param('agentId') agentId: string): Promise<void> {
    await this.agentsService.delete(agentId);
  }
}


