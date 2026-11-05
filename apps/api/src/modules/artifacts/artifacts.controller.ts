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
import { ParseUuidV7Pipe } from '../../common/identifiers/index.js';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import { ArtifactsService } from './artifacts.service.js';
import {
  ArtifactResponseDto,
  CreateArtifactDto,
  ListArtifactsQueryDto,
  PaginatedArtifactsResponseDto,
  UpdateArtifactDto,
} from './dto/index.js';

/**
 * Controller exposing REST CRUD endpoints for artifact metadata resources.
 *
 * An artifact is a first-class work product (document, code, file, structured data)
 * produced by an agent or supplied by the user, belonging to a project and/or chat.
 *
 * Endpoints:
 * - `GET /api/v1/artifacts`: List artifacts with filtering, pagination, and sorting.
 * - `POST /api/v1/artifacts`: Create a new artifact (inline text or file reference).
 * - `GET /api/v1/artifacts/:artifactId`: Retrieve an individual artifact by ID.
 * - `PATCH /api/v1/artifacts/:artifactId`: Partially update artifact fields.
 * - `DELETE /api/v1/artifacts/:artifactId`: Permanently delete an artifact and clean up its file.
 *
 * Cascade behavior:
 * Artifacts deliberately survive deletion of their parent project, chat, or agent.
 * Their foreign keys are set to NULL via `ON DELETE SET NULL`.
 */
@ApiTags('artifacts')
@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly artifactsService: ArtifactsService) {}

  /**
   * `GET /artifacts` — paginated list of artifacts matching optional filters.
   */
  @Get()
  @ApiOperation({
    summary: 'List artifacts',
    description:
      'Returns a paginated collection of artifacts, filterable by projectId, chatId, agentId, and type, and sortable by createdAt, updatedAt, title, type, or version.',
  })
  @ApiOkResponse({
    description: 'Paginated collection of artifacts (inline content omitted)',
    type: PaginatedArtifactsResponseDto,
  })
  async findAll(
    @Query() query: ListArtifactsQueryDto,
  ): Promise<PaginatedResponse<ArtifactResponseDto>> {
    return this.artifactsService.findAll(query);
  }

  /**
   * `GET /artifacts/:artifactId` — retrieve an individual artifact by ID.
   */
  @Get(':artifactId')
  @ApiOperation({
    summary: 'Retrieve an artifact',
    description:
      'Returns an artifact by ID, including its inline content if stored inline.',
  })
  @ApiParam({ name: 'artifactId', description: 'Unique artifact identifier (UUIDv7)' })
  @ApiOkResponse({
    description: 'The requested artifact resource',
    type: ArtifactResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Artifact not found' })
  async findOne(
    @Param('artifactId', ParseUuidV7Pipe) artifactId: string,
  ): Promise<ArtifactResponseDto> {
    return this.artifactsService.findOne(artifactId);
  }

  /**
   * `POST /artifacts` — create a new artifact resource.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create artifact',
    description:
      'Creates a new artifact with either inline content or a file reference. Sets the Location response header.',
  })
  @ApiCreatedResponse({
    description: 'The created artifact resource',
    type: ArtifactResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or content/filePath XOR rule violated',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Referenced projectId, chatId, or agentId does not exist',
  })
  async create(
    @Body() dto: CreateArtifactDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ArtifactResponseDto> {
    const created = await this.artifactsService.create(dto);
    res.setHeader('Location', `/api/v1/artifacts/${created.id}`);
    return created;
  }

  /**
   * `PATCH /artifacts/:artifactId` — partially update an existing artifact.
   */
  @Patch(':artifactId')
  @ApiOperation({
    summary: 'Update an artifact',
    description:
      'Partially updates an artifact. Increments version counter if fields are modified. Preserves content/file XOR invariant.',
  })
  @ApiParam({ name: 'artifactId', description: 'Unique artifact identifier (UUIDv7)' })
  @ApiOkResponse({
    description: 'The updated artifact resource',
    type: ArtifactResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or content/filePath invariant violated',
  })
  @ApiNotFoundResponse({ description: 'Artifact not found' })
  @ApiUnprocessableEntityResponse({
    description: 'Updated parent reference does not exist',
  })
  async update(
    @Param('artifactId', ParseUuidV7Pipe) artifactId: string,
    @Body() dto: UpdateArtifactDto,
  ): Promise<ArtifactResponseDto> {
    return this.artifactsService.update(artifactId, dto);
  }

  /**
   * `DELETE /artifacts/:artifactId` — delete an artifact and clean up any backing file.
   */
  @Delete(':artifactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an artifact',
    description:
      'Permanently deletes an artifact from the database and cleans up its backing file if present.',
  })
  @ApiParam({ name: 'artifactId', description: 'Unique artifact identifier (UUIDv7)' })
  @ApiNoContentResponse({ description: 'Artifact deleted successfully' })
  @ApiNotFoundResponse({ description: 'Artifact not found' })
  async delete(
    @Param('artifactId', ParseUuidV7Pipe) artifactId: string,
  ): Promise<void> {
    await this.artifactsService.delete(artifactId);
  }
}
