import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponseDto } from '../../common/http/api-error.js';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import { AgentPictureInterceptor } from './agent-picture.interceptor.js';
import { AgentsService } from './agents.service.js';
import { AgentResponseDto } from './dto/agent-response.dto.js';
import { CreateAgentDto } from './dto/create-agent.dto.js';
import { ListAgentsQueryDto } from './dto/list-agents-query.dto.js';
import { PaginatedAgentsResponseDto } from './dto/paginated-agents-response.dto.js';
import { UpdateAgentDto } from './dto/update-agent.dto.js';
import { UploadAgentPictureDto } from './dto/upload-agent-picture.dto.js';

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
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description:
      'Maximum number of items returned per page (default: 50, max: 100)',
    example: 50,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Zero-based offset of the first item returned (default: 0)',
    example: 0,
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    type: String,
    description: "Field to sort by ('createdAt', 'name', 'id', 'updatedAt')",
    example: 'createdAt',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['asc', 'desc'],
    description: "Sort direction ('asc' or 'desc', default: 'desc')",
    example: 'desc',
  })
  @ApiQuery({
    name: 'modelId',
    required: false,
    type: String,
    description:
      'Filter by model ID. Pass "null" to filter for agents without an assigned model.',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  @ApiQuery({
    name: 'systemPromptId',
    required: false,
    type: String,
    description:
      'Filter by system prompt template ID. Pass "null" to filter for agents without an assigned template.',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    type: String,
    description: 'Case-insensitive substring search matching agent name',
    example: 'researcher',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Alias for name substring search',
    example: 'researcher',
  })
  @ApiOkResponse({
    description: 'Paginated list of agents matching query criteria',
    type: PaginatedAgentsResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid pagination, sorting, or filter query parameters',
    type: ApiErrorResponseDto,
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
    type: ApiErrorResponseDto,
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
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Referenced foreign key (modelId or systemPromptId) does not exist',
    type: ApiErrorResponseDto,
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
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No agent found with that ID',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Referenced foreign key (modelId or systemPromptId) does not exist',
    type: ApiErrorResponseDto,
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
    type: ApiErrorResponseDto,
  })
  async delete(@Param('agentId') agentId: string): Promise<void> {
    await this.agentsService.delete(agentId);
  }

  @Put(':agentId/picture')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(AgentPictureInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload an agent profile picture',
    description:
      'Uploads a profile picture for the agent (PUT replaces any existing picture). Only JPEG, PNG, WebP, and GIF images are permitted. SVG is excluded to prevent stored XSS. File size is bounded by configuration.',
  })
  @ApiParam({
    name: 'agentId',
    description: 'Unique agent identifier',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiBody({
    description:
      'Profile picture image file (JPEG, PNG, WebP, or GIF up to configured max size)',
    type: UploadAgentPictureDto,
  })
  @ApiOkResponse({
    description: 'Picture uploaded and agent updated successfully',
    type: AgentResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'No file uploaded, file is empty, or unsupported media type (non-image or SVG)',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No agent found with that ID',
    type: ApiErrorResponseDto,
  })
  @ApiPayloadTooLargeResponse({
    description: 'Uploaded file exceeds configured maximum size limit',
    type: ApiErrorResponseDto,
  })
  async uploadPicture(
    @Param('agentId') agentId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AgentResponseDto> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'MISSING_FILE',
        message: 'No file uploaded or file is empty',
      });
    }

    return this.agentsService.uploadPicture(agentId, file);
  }

  @Delete(':agentId/picture')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove an agent profile picture',
    description:
      'Deletes an agent profile picture and unlinks the stored file. Idempotent: removing a picture from an agent that has none returns 204 No Content.',
  })
  @ApiParam({
    name: 'agentId',
    description: 'Unique agent identifier',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiNoContentResponse({
    description: 'Picture removed successfully or agent had no picture',
  })
  @ApiNotFoundResponse({
    description: 'No agent found with that ID',
    type: ApiErrorResponseDto,
  })
  async deletePicture(@Param('agentId') agentId: string): Promise<void> {
    await this.agentsService.deletePicture(agentId);
  }
}
