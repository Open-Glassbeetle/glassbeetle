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
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponseDto } from '../../common/http/api-error.js';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import {
  CreateTeamDto,
  ListTeamsQueryDto,
  PaginatedTeamsResponseDto,
  TeamResponseDto,
  UpdateTeamDto,
} from './dto/index.js';
import { TeamsService } from './teams.service.js';

/**
 * Routes for `/teams`: the team collection and single teams.
 *
 * A team groups agents so that a chat can be owned by several of them at
 * once. Each response carries the size of the roster, which is why the
 * service joins rather than letting a client count.
 *
 * The roster itself lives under `TeamMembersController`.
 */
@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  /**
   * `GET /teams` — paginated list with roster sizes, filterable by name.
   */
  @Get()
  @ApiOperation({
    summary: 'List teams',
    description:
      'Retrieves stored teams with pagination, sorting and a name filter. Each team carries the size of its roster.',
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
    description: "Field to sort by ('createdAt', 'updatedAt', 'name', 'id')",
    example: 'name',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['asc', 'desc'],
    description: "Sort direction (default: 'desc')",
    example: 'asc',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    type: String,
    description: 'Case-insensitive substring search matching the team name',
    example: 'research',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Alias for the name filter',
    example: 'research',
  })
  @ApiOkResponse({
    description: 'Paginated list of teams',
    type: PaginatedTeamsResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid pagination, sorting or filter query parameters',
    type: ApiErrorResponseDto,
  })
  async findAll(
    @Query() query: ListTeamsQueryDto,
  ): Promise<PaginatedResponse<TeamResponseDto>> {
    return this.teamsService.findAll(query);
  }

  /**
   * `GET /teams/:teamId` — one team with its roster size.
   */
  @Get(':teamId')
  @ApiOperation({
    summary: 'Retrieve a team',
    description: 'Retrieves a single team and the size of its roster.',
  })
  @ApiParam({ name: 'teamId', description: 'Unique team identifier' })
  @ApiOkResponse({
    description: 'Team found and returned',
    type: TeamResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No team found with that ID',
    type: ApiErrorResponseDto,
  })
  async findOne(@Param('teamId') teamId: string): Promise<TeamResponseDto> {
    return this.teamsService.findOne(teamId);
  }

  /**
   * `POST /teams` — create a team with an empty roster.
   *
   * Sets the `Location` header, which is why it takes the response object.
   * Members are added through the roster endpoints afterwards.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a team',
    description: `Creates a team with server-managed identifiers and timestamps.

The roster starts empty; agents are put on it with \`POST /teams/:teamId/members\`.`,
  })
  @ApiCreatedResponse({
    description: 'Team created successfully',
    type: TeamResponseDto,
    headers: {
      Location: {
        description: 'URI of the newly created team',
        schema: {
          type: 'string',
          example: '/api/v1/teams/018f3a9e-0000-7000-8000-000000000001',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Request validation failed (e.g. missing name, over-long fields, or client-supplied server-managed fields)',
    type: ApiErrorResponseDto,
  })
  async create(
    @Body() dto: CreateTeamDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TeamResponseDto> {
    const created = await this.teamsService.create(dto);
    res.setHeader('Location', `/api/v1/teams/${created.id}`);
    return created;
  }

  /**
   * `PATCH /teams/:teamId` — change the name or description.
   *
   * The roster is not updated here; it has its own endpoints.
   */
  @Patch(':teamId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a team',
    description:
      'Applies partial updates to a team. Only supplied fields are changed; an explicit null clears the description. An empty body is a no-op.',
  })
  @ApiParam({ name: 'teamId', description: 'Unique team identifier' })
  @ApiOkResponse({
    description: 'Team updated successfully',
    type: TeamResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Request validation failed',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No team found with that ID',
    type: ApiErrorResponseDto,
  })
  async update(
    @Param('teamId') teamId: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<TeamResponseDto> {
    return this.teamsService.update(teamId, dto);
  }

  /**
   * `DELETE /teams/:teamId` — delete a team.
   *
   * The roster cascades away with it. The agents themselves survive, because
   * membership is a relationship and not ownership.
   */
  @Delete(':teamId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a team',
    description: `Permanently deletes a team.

Cascade behaviour:
- \`team_members\` (team_id NOT NULL): CASCADE — the roster is destroyed. The agents themselves are untouched; membership is a relationship, not ownership.
- \`chats\` (team_id nullable): SET NULL — chats survive, unbound. Note that \`chats\` has a CHECK requiring exactly one of \`agent_id\` and \`team_id\`, so deleting a team that owns chats violates it; this is the same gap as deleting an agent with chats (issue #29) and there is no chats endpoint yet to reach that state through.`,
  })
  @ApiParam({ name: 'teamId', description: 'Unique team identifier' })
  @ApiNoContentResponse({ description: 'Team successfully deleted' })
  @ApiNotFoundResponse({
    description: 'No team found with that ID',
    type: ApiErrorResponseDto,
  })
  async delete(@Param('teamId') teamId: string): Promise<void> {
    await this.teamsService.delete(teamId);
  }
}
