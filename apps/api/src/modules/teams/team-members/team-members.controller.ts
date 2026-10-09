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
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponseDto } from '../../../common/http/api-error.js';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import {
  AddTeamMemberDto,
  ReorderTeamMembersDto,
  TeamMemberResponseDto,
  UpdateTeamMemberDto,
} from './dto/index.js';
import { ListTeamMembersQueryDto } from './dto/list-team-members-query.dto.js';
import { PaginatedTeamMembersResponseDto } from './dto/paginated-team-members-response.dto.js';
import { TeamMembersService } from './team-members.service.js';

/**
 * A team's roster.
 *
 * The order of this collection is the order the agents take their turn in a
 * team chat, which is why it is maintained as a dense sequence and why there
 * is a dedicated endpoint for rewriting it.
 */
@ApiTags('teams')
@Controller('teams/:teamId/members')
export class TeamMembersController {
  constructor(private readonly teamMembersService: TeamMembersService) {}

  @Get()
  @ApiOperation({
    summary: 'List a team roster',
    description:
      'Retrieves the agents on a team, in turn order. Only the agent ids are returned; a client that needs names resolves them against the agent roster it already holds.',
  })
  @ApiParam({ name: 'teamId', description: 'Unique team identifier' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiQuery({
    name: 'sort',
    required: false,
    type: String,
    description:
      "Only 'position' is accepted: a roster's order is its turn order, and any other ordering would present a sequence the team will never run in.",
    example: 'position',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['asc', 'desc'],
    description: "Sort direction (default: 'asc')",
  })
  @ApiOkResponse({
    description: 'The roster, in turn order',
    type: PaginatedTeamMembersResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid pagination or sort parameters',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No team found with that ID',
    type: ApiErrorResponseDto,
  })
  async findAll(
    @Param('teamId') teamId: string,
    @Query() query: ListTeamMembersQueryDto,
  ): Promise<PaginatedResponse<TeamMemberResponseDto>> {
    return this.teamMembersService.findAll(teamId, query);
  }

  @Get(':agentId')
  @ApiOperation({
    summary: 'Retrieve one membership',
    description: "Retrieves one agent's place on a team.",
  })
  @ApiParam({ name: 'teamId', description: 'Unique team identifier' })
  @ApiParam({ name: 'agentId', description: 'Unique agent identifier' })
  @ApiOkResponse({
    description: 'Membership found',
    type: TeamMemberResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No such team, or that agent is not on it',
    type: ApiErrorResponseDto,
  })
  async findOne(
    @Param('teamId') teamId: string,
    @Param('agentId') agentId: string,
  ): Promise<TeamMemberResponseDto> {
    return this.teamMembersService.findOne(teamId, agentId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Put an agent on a team',
    description:
      'Appends an agent to the end of the roster. Adding an agent that is already on the team is a conflict rather than a no-op: it is a mistake worth reporting, and succeeding silently would hide a double-submitted form behind a roster that did not change.',
  })
  @ApiParam({ name: 'teamId', description: 'Unique team identifier' })
  @ApiCreatedResponse({
    description: 'Agent added to the roster',
    type: TeamMemberResponseDto,
    headers: {
      Location: {
        description: 'URI of the new membership',
        schema: {
          type: 'string',
          example:
            '/api/v1/teams/018f3a9e-0000-7000-8000-000000000001/members/018f3a9e-0000-7000-8000-000000000002',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Request validation failed (e.g. missing agentId)',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No team found with that ID',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'That agent is already on this team',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'The agent named in the body does not exist',
    type: ApiErrorResponseDto,
  })
  async add(
    @Param('teamId') teamId: string,
    @Body() dto: AddTeamMemberDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TeamMemberResponseDto> {
    const created = await this.teamMembersService.add(teamId, dto);
    res.setHeader(
      'Location',
      `/api/v1/teams/${teamId}/members/${created.agentId}`,
    );
    return created;
  }

  @Put('order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rewrite the turn order',
    description: `Replaces the roster's order in one transaction.

The body names every agent currently on the team, in the order they should take their turn. A list that does not match the current membership exactly is refused, so a client working from a stale view cannot reorder around a member that has since left or been added.`,
  })
  @ApiParam({ name: 'teamId', description: 'Unique team identifier' })
  @ApiOkResponse({
    description: 'The reordered roster',
    type: PaginatedTeamMembersResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Request validation failed (e.g. an empty list)',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No team found with that ID',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'The list repeats an agent, or does not name exactly the current membership',
    type: ApiErrorResponseDto,
  })
  async reorder(
    @Param('teamId') teamId: string,
    @Body() dto: ReorderTeamMembersDto,
  ): Promise<PaginatedResponse<TeamMemberResponseDto>> {
    return this.teamMembersService.reorder(teamId, dto);
  }

  @Patch(':agentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change a role on the team',
    description: `Updates the role label for one membership. An explicit null clears it, and an empty body is a no-op.

Position is not accepted here: it is kept as a dense sequence, so one row changing its number would collide with another or leave a gap. Use \`PUT /teams/:teamId/members/order\`.`,
  })
  @ApiParam({ name: 'teamId', description: 'Unique team identifier' })
  @ApiParam({ name: 'agentId', description: 'Unique agent identifier' })
  @ApiOkResponse({
    description: 'Membership updated',
    type: TeamMemberResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Request validation failed (e.g. an over-long role, or a position)',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No such team, or that agent is not on it',
    type: ApiErrorResponseDto,
  })
  async update(
    @Param('teamId') teamId: string,
    @Param('agentId') agentId: string,
    @Body() dto: UpdateTeamMemberDto,
  ): Promise<TeamMemberResponseDto> {
    return this.teamMembersService.update(teamId, agentId, dto);
  }

  @Delete(':agentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Take an agent off a team',
    description:
      'Removes one membership and closes the gap it leaves, so the remaining turn order stays a dense sequence. The agent itself is untouched.',
  })
  @ApiParam({ name: 'teamId', description: 'Unique team identifier' })
  @ApiParam({ name: 'agentId', description: 'Unique agent identifier' })
  @ApiNoContentResponse({ description: 'Agent removed from the roster' })
  @ApiNotFoundResponse({
    description: 'No such team, or that agent is not on it',
    type: ApiErrorResponseDto,
  })
  async remove(
    @Param('teamId') teamId: string,
    @Param('agentId') agentId: string,
  ): Promise<void> {
    await this.teamMembersService.remove(teamId, agentId);
  }
}
