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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  PaginatedProjectsResponseDto,
  ProjectResponseDto,
  UpdateProjectDto,
} from './dto/index.js';
import { ProjectsService } from './projects.service.js';

/**
 * Controller exposing REST CRUD endpoints for project resources.
 *
 * A project is an organizing container for related chats and artifacts.
 *
 * Routes:
 * - `GET /api/v1/projects`: List projects with pagination, sorting and name substring filter.
 * - `POST /api/v1/projects`: Create a new project.
 * - `GET /api/v1/projects/:projectId`: Retrieve a single project by ID with chat/artifact counts.
 * - `PATCH /api/v1/projects/:projectId`: Partially update an existing project.
 * - `DELETE /api/v1/projects/:projectId`: Permanently delete a project.
 *
 * Deletion cascade behavior:
 * Both `chats.project_id` and `artifacts.project_id` use `ON DELETE SET NULL`.
 * Deleting a project does NOT delete any chats or artifacts; they survive intact, unfiled.
 */
@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * `GET /projects` — paginated list of projects, filterable by name substring.
   */
  @Get()
  @ApiOperation({
    summary: 'List projects',
    description:
      'Returns a paginated collection of projects, filterable by a name substring and sortable by name or timestamps.',
  })
  @ApiOkResponse({
    description: 'Paginated collection of projects',
    type: PaginatedProjectsResponseDto,
  })
  async findAll(
    @Query() query: ListProjectsQueryDto,
  ): Promise<PaginatedResponse<ProjectResponseDto>> {
    return this.projectsService.findAll(query);
  }

  /**
   * `GET /projects/:projectId` — retrieve a single project by ID.
   */
  @Get(':projectId')
  @ApiOperation({
    summary: 'Retrieve a project',
    description:
      'Returns a project by ID, including counts of associated chats and artifacts.',
  })
  @ApiParam({ name: 'projectId', description: 'Unique project identifier' })
  @ApiOkResponse({
    description: 'The requested project resource',
    type: ProjectResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Project not found' })
  async findOne(
    @Param('projectId') projectId: string,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.findOne(projectId);
  }

  /**
   * `POST /projects` — create a new project.
   *
   * Sets the `Location` header to `/api/v1/projects/:projectId`.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a project',
    description:
      'Creates a new project with server-managed ID and timestamps.',
  })
  @ApiCreatedResponse({
    description: 'Project created successfully',
    type: ProjectResponseDto,
    headers: {
      Location: {
        description: 'URI of the newly created project',
        schema: {
          type: 'string',
          example: '/api/v1/projects/018f3a9e-0000-7000-8000-000000000001',
        },
      },
    },
  })
  async create(
    @Body() dto: CreateProjectDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProjectResponseDto> {
    const created = await this.projectsService.create(dto);
    res.setHeader('Location', `/api/v1/projects/${created.id}`);
    return created;
  }

  /**
   * `PATCH /projects/:projectId` — partially update an existing project.
   */
  @Patch(':projectId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a project',
    description:
      'Partially updates a project. Only supplied fields are changed; an explicit null clears description. Empty body is a no-op.',
  })
  @ApiParam({ name: 'projectId', description: 'Unique project identifier' })
  @ApiOkResponse({
    description: 'Project updated successfully',
    type: ProjectResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Project not found' })
  async update(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.update(projectId, dto);
  }

  /**
   * `DELETE /projects/:projectId` — permanently delete a project.
   *
   * Referencing chats and artifacts survive intact with their `projectId` set to null.
   * The project image file (if present) is unlinked from storage.
   */
  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a project',
    description:
      'Permanently deletes a project. Contained chats and artifacts survive unfiled (SET NULL). Stored project image file is unlinked.',
  })
  @ApiParam({ name: 'projectId', description: 'Unique project identifier' })
  @ApiNoContentResponse({ description: 'Project deleted successfully' })
  @ApiNotFoundResponse({ description: 'Project not found' })
  async delete(@Param('projectId') projectId: string): Promise<void> {
    await this.projectsService.delete(projectId);
  }
}
