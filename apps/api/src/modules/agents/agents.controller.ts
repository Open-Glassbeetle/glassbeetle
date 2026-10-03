import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import { AgentsService } from './agents.service.js';
import { AgentResponseDto } from './dto/agent-response.dto.js';
import { ListAgentsQueryDto } from './dto/list-agents-query.dto.js';

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
}
