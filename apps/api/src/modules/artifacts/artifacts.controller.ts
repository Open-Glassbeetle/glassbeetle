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
  Req,
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
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ParseUuidV7Pipe } from '../../common/identifiers/index.js';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import { matchesEtag } from '../user/user.controller.js';
import {
  parseRangeHeader,
  resolveContentSecurityPolicy,
} from './artifacts-content-policy.js';
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
  @ApiParam({
    name: 'artifactId',
    description: 'Unique artifact identifier (UUIDv7)',
  })
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
   * `GET /artifacts/:artifactId/content` — retrieve the artifact's actual content.
   */
  @Get(':artifactId/content')
  @ApiOperation({
    summary: 'Retrieve artifact content',
    description:
      "Returns an artifact's actual content — inline text straight from the database, or a file streamed from storage. Content-Type and Content-Disposition are strictly enforced according to security policy to prevent stored XSS.",
  })
  @ApiParam({
    name: 'artifactId',
    description: 'Unique artifact identifier (UUIDv7)',
  })
  @ApiOkResponse({
    description: 'The artifact content (inline text or streamed file)',
  })
  @ApiResponse({
    status: HttpStatus.PARTIAL_CONTENT,
    description: 'Partial range of artifact file content',
  })
  @ApiResponse({
    status: HttpStatus.NOT_MODIFIED,
    description: 'Artifact content has not changed (ETag match)',
  })
  @ApiBadRequestResponse({
    description: 'artifactId is not a valid UUIDv7 or file path is invalid',
  })
  @ApiNotFoundResponse({
    description:
      'Artifact not found, has no content or file, or backing file is missing from storage',
  })
  async getContent(
    @Param('artifactId', ParseUuidV7Pipe) artifactId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const artifact = await this.artifactsService.openContent(artifactId);

    const { contentType, disposition } = resolveContentSecurityPolicy({
      mimeType: artifact.mimeType,
      isInline: artifact.kind === 'inline',
      title: artifact.title,
    });

    const etag = `"${artifact.version}-${artifact.size}"`;
    const lastModified = new Date(artifact.updatedAt).toUTCString();

    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('Accept-Ranges', 'bytes');

    // Conditional requests (ETag and If-Modified-Since)
    const ifNoneMatch = Array.isArray(req.headers['if-none-match'])
      ? req.headers['if-none-match'].join(', ')
      : req.headers['if-none-match'];

    if (matchesEtag(ifNoneMatch, etag)) {
      res.status(HttpStatus.NOT_MODIFIED);
      res.end();
      return;
    }

    const ifModifiedSince = Array.isArray(req.headers['if-modified-since'])
      ? req.headers['if-modified-since'][0]
      : req.headers['if-modified-since'];

    if (ifModifiedSince) {
      const parsedIfModifiedSince = new Date(ifModifiedSince);
      if (
        !isNaN(parsedIfModifiedSince.getTime()) &&
        new Date(artifact.updatedAt).getTime() <=
          parsedIfModifiedSince.getTime()
      ) {
        res.status(HttpStatus.NOT_MODIFIED);
        res.end();
        return;
      }
    }

    if (artifact.kind === 'inline') {
      res.status(HttpStatus.OK);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', artifact.size);
      res.setHeader('Content-Disposition', disposition);
      res.end(artifact.content);
      return;
    }

    // File content with streaming and optional range support
    const ifRange = Array.isArray(req.headers['if-range'])
      ? req.headers['if-range'][0]
      : req.headers['if-range'];
    const rangeHeader = Array.isArray(req.headers.range)
      ? req.headers.range[0]
      : req.headers.range;

    const rangeApplies = !ifRange || matchesEtag(ifRange, etag);
    const rangeResult = rangeApplies
      ? parseRangeHeader(rangeHeader, artifact.size)
      : null;

    if (rangeResult === 'unsatisfiable') {
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      res.setHeader('Content-Range', `bytes */${artifact.size}`);
      res.end();
      return;
    }

    if (rangeResult) {
      const { start, end } = rangeResult;
      const contentLength = end - start + 1;
      res.status(HttpStatus.PARTIAL_CONTENT);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${artifact.size}`);
      res.setHeader('Content-Length', contentLength);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', disposition);

      const stream = await artifact.openStream({ start, end });
      await this.pipeStreamToResponse(stream, res);
      return;
    }

    res.status(HttpStatus.OK);
    res.setHeader('Content-Length', artifact.size);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', disposition);

    const stream = await artifact.openStream();
    await this.pipeStreamToResponse(stream, res);
  }

  private pipeStreamToResponse(
    stream: NodeJS.ReadableStream,
    res: Response,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      stream.on('error', (err) => {
        if (res.headersSent) {
          // Headers already sent; status code cannot be changed.
          // Terminate the socket connection to signal failure to client.
          res.destroy(err);
          resolve();
        } else {
          reject(err);
        }
      });

      res.on('error', (err) => {
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          stream.destroy(err);
        }
        resolve();
      });

      res.on('close', () => {
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          stream.destroy();
        }
        resolve();
      });

      stream.on('end', () => {
        resolve();
      });

      stream.pipe(res);
    });
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
  @ApiParam({
    name: 'artifactId',
    description: 'Unique artifact identifier (UUIDv7)',
  })
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
  @ApiParam({
    name: 'artifactId',
    description: 'Unique artifact identifier (UUIDv7)',
  })
  @ApiNoContentResponse({ description: 'Artifact deleted successfully' })
  @ApiNotFoundResponse({ description: 'Artifact not found' })
  async delete(
    @Param('artifactId', ParseUuidV7Pipe) artifactId: string,
  ): Promise<void> {
    await this.artifactsService.delete(artifactId);
  }
}
