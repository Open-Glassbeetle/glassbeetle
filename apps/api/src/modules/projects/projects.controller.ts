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
  Req,
  Res,
  StreamableFile,
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
  ApiProduces,
  ApiResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PictureUploadInterceptor } from '../../common/http/picture-upload.interceptor.js';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  PaginatedProjectsResponseDto,
  ProjectResponseDto,
  UpdateProjectDto,
  UploadProjectImageDto,
} from './dto/index.js';
import { matchesEtag } from '../user/user.controller.js';
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
 * - `PUT /api/v1/projects/:projectId/image`: Upload or replace the project image.
 * - `GET /api/v1/projects/:projectId/image`: Download the project image.
 * - `DELETE /api/v1/projects/:projectId/image`: Remove the project image.
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

  /**
   * `PUT /projects/:projectId/image` — upload or replace the project image.
   *
   * Replaces any existing project image. Enforces image type allow-list via magic
   * bytes, rejecting SVG to protect against stored XSS in Tauri webview.
   * File size limit is dynamically read from configuration and enforced during
   * upload streaming by multer.
   */
  @Put(':projectId/image')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(PictureUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a project image',
    description:
      'Uploads a cover image for the project (PUT replaces any existing image). Only JPEG, PNG, WebP, and GIF images are permitted. SVG is excluded to prevent stored XSS. File size is bounded by configuration.',
  })
  @ApiParam({
    name: 'projectId',
    description: 'Unique project identifier',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiBody({
    description:
      'Project image file (JPEG, PNG, WebP, or GIF up to configured max size)',
    type: UploadProjectImageDto,
  })
  @ApiOkResponse({
    description: 'Image uploaded and project updated successfully',
    type: ProjectResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'No file uploaded or file is empty',
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      'Unsupported media type (non-image or SVG); detected type is not permitted',
  })
  @ApiNotFoundResponse({
    description: 'Project not found',
  })
  @ApiPayloadTooLargeResponse({
    description: 'Uploaded file exceeds configured maximum size limit',
  })
  async uploadImage(
    @Param('projectId') projectId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ProjectResponseDto> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'MISSING_FILE',
        message: 'No file uploaded or file is empty',
      });
    }

    return this.projectsService.uploadImage(projectId, file);
  }

  /**
   * `GET /projects/:projectId/image` — the stored image, with revalidation.
   *
   * Mirrors `GET /agents/:agentId/picture`: sets the validators before
   * deciding what to send, so a 304 carries the same `ETag` as the 200 would.
   * `nosniff` is set because the body is user-supplied bytes rendered inside
   * the desktop webview.
   *
   * @throws NotFoundException (404) when the project does not exist, when no
   * image is stored, or when the recorded file is missing from the storage
   * root.
   */
  @Get(':projectId/image')
  @ApiOperation({
    summary: 'Download a project image',
    description: `Serves the stored cover image for a project.

The content type is detected from the file's own bytes rather than from anything the uploading client claimed. The URL is stable across replacements, so the response carries an \`ETag\` and revalidates: a conditional request with a matching \`If-None-Match\` gets \`304 Not Modified\`.`,
  })
  @ApiParam({
    name: 'projectId',
    description: 'Unique project identifier',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  @ApiOkResponse({
    description: 'The stored project image',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({
    status: HttpStatus.NOT_MODIFIED,
    description: 'The client already holds this image',
  })
  @ApiNotFoundResponse({
    description:
      'No project found with that ID (PROJECT_NOT_FOUND), or no image is stored / the stored file is missing from the storage root (IMAGE_NOT_FOUND)',
  })
  async findImage(
    @Param('projectId') projectId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const image = await this.projectsService.openImage(projectId);

    res.setHeader('ETag', image.etag);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (matchesEtag(req.headers['if-none-match'], image.etag)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return new StreamableFile(await image.open(), {
      type: image.contentType,
      length: image.size,
      // No filename: the stored name is a generated UUIDv7 and the uploaded
      // one was discarded, so there is nothing truthful to put in it.
      disposition: 'inline',
    });
  }

  /**
   * `DELETE /projects/:projectId/image` — remove the project image.
   *
   * Idempotent: 204 whether or not the project had one. A missing project is
   * still a 404, since the path then names nothing.
   */
  @Delete(':projectId/image')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a project image',
    description:
      'Deletes a project image and unlinks the stored file. Idempotent: removing the image from a project that has none returns 204 No Content.',
  })
  @ApiParam({
    name: 'projectId',
    description: 'Unique project identifier',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiNoContentResponse({
    description: 'Image removed successfully or project had no image',
  })
  @ApiNotFoundResponse({ description: 'Project not found' })
  async deleteImage(@Param('projectId') projectId: string): Promise<void> {
    await this.projectsService.deleteImage(projectId);
  }
}
