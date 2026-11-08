import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
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
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ParseUuidV7Pipe } from '../../common/identifiers/index.js';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import { matchesEtag } from '../user/user.controller.js';
import { ArtifactUploadInterceptor } from './artifact-upload.interceptor.js';
import {
  parseRangeHeader,
  resolveContentSecurityPolicy,
} from './artifacts-content-policy.js';
import { ArtifactContent, ArtifactsService } from './artifacts.service.js';
import {
  ArtifactResponseDto,
  ArtifactVersionResponseDto,
  CreateArtifactDto,
  ListArtifactVersionsQueryDto,
  ListArtifactsQueryDto,
  PaginatedArtifactsResponseDto,
  PaginatedArtifactVersionsResponseDto,
  UpdateArtifactDto,
  UploadArtifactContentDto,
} from './dto/index.js';

/**
 * Controller exposing REST CRUD endpoints for artifact metadata resources,
 * file content streaming/uploading, and version history lifecycle.
 *
 * An artifact is a first-class work product (document, code, file, structured data)
 * produced by an agent or supplied by the user, belonging to a project and/or chat.
 *
 * Endpoints:
 * - `GET /api/v1/artifacts`: List artifacts with filtering, pagination, and sorting.
 * - `POST /api/v1/artifacts`: Create a new artifact (inline text or file reference).
 * - `GET /api/v1/artifacts/:artifactId`: Retrieve an individual artifact by ID.
 * - `PATCH /api/v1/artifacts/:artifactId`: Partially update artifact fields (snapshots version).
 * - `DELETE /api/v1/artifacts/:artifactId`: Permanently delete an artifact, versions, and backing files.
 * - `GET /api/v1/artifacts/:artifactId/content`: Stream/serve active artifact content with security headers.
 * - `PUT /api/v1/artifacts/:artifactId/content`: Upload file content, bumping version and snapshotting.
 * - `GET /api/v1/artifacts/:artifactId/versions`: List historical version records.
 * - `GET /api/v1/artifacts/:artifactId/versions/:version`: Retrieve historical version metadata and inline content.
 * - `GET /api/v1/artifacts/:artifactId/versions/:version/content`: Stream/serve historical version content.
 * - `POST /api/v1/artifacts/:artifactId/versions/:version/restore`: Roll forward to restore a historical version.
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
    await this.serveArtifactContent(artifact, req, res);
  }

  /**
   * `PUT /artifacts/:artifactId/content` — upload backing file content for an artifact.
   */
  @Put(':artifactId/content')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(ArtifactUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload artifact file content',
    description:
      'Uploads file content for an artifact (PUT replaces existing content/file). Creates an immutable historical version snapshot of the previous state.',
  })
  @ApiParam({
    name: 'artifactId',
    description: 'Unique artifact identifier (UUIDv7)',
  })
  @ApiBody({
    description: 'Artifact content file (up to 100 MiB)',
    type: UploadArtifactContentDto,
  })
  @ApiOkResponse({
    description: 'Artifact file uploaded successfully',
    type: ArtifactResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'No file uploaded or file is empty',
  })
  @ApiNotFoundResponse({
    description: 'Artifact not found',
  })
  @ApiPayloadTooLargeResponse({
    description: 'Uploaded file exceeds the maximum limit of 100 MiB',
  })
  async uploadContent(
    @Param('artifactId', ParseUuidV7Pipe) artifactId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ArtifactResponseDto> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'MISSING_FILE',
        message: 'No file uploaded or file is empty',
      });
    }

    return this.artifactsService.uploadContent(artifactId, file);
  }

  /**
   * `GET /artifacts/:artifactId/versions` — retrieve paginated version history for an artifact.
   */
  @Get(':artifactId/versions')
  @ApiOperation({
    summary: 'List artifact versions',
    description:
      'Returns a paginated collection of historical versions for an artifact, ordered by version descending by default (inline content omitted).',
  })
  @ApiParam({
    name: 'artifactId',
    description: 'Unique artifact identifier (UUIDv7)',
  })
  @ApiOkResponse({
    description: 'Paginated collection of historical versions',
    type: PaginatedArtifactVersionsResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Artifact not found' })
  async findAllVersions(
    @Param('artifactId', ParseUuidV7Pipe) artifactId: string,
    @Query() query: ListArtifactVersionsQueryDto,
  ): Promise<PaginatedResponse<ArtifactVersionResponseDto>> {
    return this.artifactsService.findAllVersions(artifactId, query);
  }

  /**
   * `GET /artifacts/:artifactId/versions/:version` — retrieve metadata and inline content for a specific past version.
   */
  @Get(':artifactId/versions/:version')
  @ApiOperation({
    summary: 'Retrieve artifact version',
    description:
      'Returns metadata and inline content (if stored inline) for a specific historical version.',
  })
  @ApiParam({
    name: 'artifactId',
    description: 'Unique artifact identifier (UUIDv7)',
  })
  @ApiParam({
    name: 'version',
    type: 'integer',
    description: 'Historical version number (positive integer)',
  })
  @ApiOkResponse({
    description: 'The requested artifact version',
    type: ArtifactVersionResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Artifact or version not found',
  })
  async findOneVersion(
    @Param('artifactId', ParseUuidV7Pipe) artifactId: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<ArtifactVersionResponseDto> {
    return this.artifactsService.findOneVersion(artifactId, version);
  }

  /**
   * `GET /artifacts/:artifactId/versions/:version/content` — stream/serve content of a specific historical version.
   */
  @Get(':artifactId/versions/:version/content')
  @ApiOperation({
    summary: 'Retrieve historical artifact version content',
    description:
      'Returns content for a specific historical version of an artifact (inline text straight from the database, or streamed from storage). Strict security headers and Content-Disposition are enforced.',
  })
  @ApiParam({
    name: 'artifactId',
    description: 'Unique artifact identifier (UUIDv7)',
  })
  @ApiParam({
    name: 'version',
    type: 'integer',
    description: 'Historical version number (positive integer)',
  })
  @ApiOkResponse({
    description: 'The version content (inline text or streamed file)',
  })
  @ApiResponse({
    status: HttpStatus.PARTIAL_CONTENT,
    description: 'Partial range of artifact version file content',
  })
  @ApiResponse({
    status: HttpStatus.NOT_MODIFIED,
    description: 'Version content has not changed (ETag match)',
  })
  @ApiNotFoundResponse({
    description:
      'Artifact or version not found, has no content or file, or backing file is missing from storage',
  })
  async getVersionContent(
    @Param('artifactId', ParseUuidV7Pipe) artifactId: string,
    @Param('version', ParseIntPipe) version: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const artifact = await this.artifactsService.openVersionContent(
      artifactId,
      version,
    );
    await this.serveArtifactContent(artifact, req, res);
  }

  /**
   * `POST /artifacts/:artifactId/versions/:version/restore` — roll forward to restore a historical version.
   */
  @Post(':artifactId/versions/:version/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore artifact version',
    description:
      'Restores a historical version by rolling forward: creates a new active version with the restored content/metadata and archives the previous active state.',
  })
  @ApiParam({
    name: 'artifactId',
    description: 'Unique artifact identifier (UUIDv7)',
  })
  @ApiParam({
    name: 'version',
    type: 'integer',
    description: 'Historical version number to restore',
  })
  @ApiOkResponse({
    description: 'Artifact rolled forward to restored state successfully',
    type: ArtifactResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Artifact or version not found',
  })
  async restoreVersion(
    @Param('artifactId', ParseUuidV7Pipe) artifactId: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<ArtifactResponseDto> {
    return this.artifactsService.restoreVersion(artifactId, version);
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
   * `DELETE /artifacts/:artifactId` — delete an artifact, all version records, and clean up backing files.
   */
  @Delete(':artifactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an artifact',
    description:
      'Permanently deletes an artifact and its historical versions from the database, unlinking backing files.',
  })
  @ApiParam({
    name: 'artifactId',
    description: 'Unique artifact identifier (UUIDv7)',
  })
  @ApiNoContentResponse({
    description: 'Artifact deleted successfully',
  })
  @ApiNotFoundResponse({ description: 'Artifact not found' })
  async delete(
    @Param('artifactId', ParseUuidV7Pipe) artifactId: string,
  ): Promise<void> {
    await this.artifactsService.delete(artifactId);
  }

  /**
   * Serves artifact content (inline text or file stream) with mandatory security headers,
   * RFC 6266 Content-Disposition, ETag revalidation, and byte-range support.
   */
  private async serveArtifactContent(
    artifact: ArtifactContent,
    req: Request,
    res: Response,
  ): Promise<void> {
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
}
