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
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponseDto } from '../../../common/http/api-error.js';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import {
  BulkDeleteQueryDto,
  BulkDeleteResponseDto,
  CreateSharedMemoryDto,
  ListSharedMemoriesQueryDto,
  SharedMemoryResponseDto,
  UpdateSharedMemoryDto,
} from './dto/index.js';
import { SharedMemoriesService } from './shared-memories.service.js';

/**
 * Controller exposing endpoints for shared (global) memory.
 *
 * Endpoints:
 * - `GET /api/v1/memories`: Lists global shared memories with pagination, sorting, and filters.
 * - `POST /api/v1/memories`: Appends a new global shared memory.
 * - `DELETE /api/v1/memories`: Clears all shared memories (requires ?confirm=true).
 * - `GET /api/v1/memories/:memoryId`: Retrieves a single shared memory.
 * - `PATCH /api/v1/memories/:memoryId`: Partially updates an existing shared memory.
 * - `DELETE /api/v1/memories/:memoryId`: Deletes a shared memory.
 */
@ApiTags('memories')
@Controller('memories')
export class SharedMemoriesController {
  constructor(private readonly sharedMemoriesService: SharedMemoriesService) {}

  @Get()
  async findAll(
    @Query() query: ListSharedMemoriesQueryDto,
  ): Promise<PaginatedResponse<SharedMemoryResponseDto>> {
    return this.sharedMemoriesService.findAll(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateSharedMemoryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SharedMemoryResponseDto> {
    const created = await this.sharedMemoriesService.create(dto);
    res.setHeader('Location', `/api/v1/memories/${created.id}`);
    return created;
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear all shared memories',
    description:
      'Permanently and irreversibly deletes all global shared memories. This operation cannot be undone. Requires explicit confirmation via the `?confirm=true` query parameter.',
  })
  @ApiQuery({
    name: 'confirm',
    description:
      'Safety confirmation parameter. Must be set to "true" to authorize irreversible deletion.',
    required: true,
    type: String,
    example: 'true',
  })
  @ApiOkResponse({
    description: 'Shared memories successfully cleared',
    type: BulkDeleteResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Missing or invalid confirmation parameter',
    type: ApiErrorResponseDto,
  })
  async removeAll(
    @Query() _query: BulkDeleteQueryDto,
  ): Promise<BulkDeleteResponseDto> {
    return this.sharedMemoriesService.removeAll();
  }

  @Get(':memoryId')
  async findOne(
    @Param('memoryId') memoryId: string,
  ): Promise<SharedMemoryResponseDto> {
    return this.sharedMemoriesService.findOne(memoryId);
  }

  @Patch(':memoryId')
  async update(
    @Param('memoryId') memoryId: string,
    @Body() dto: UpdateSharedMemoryDto,
  ): Promise<SharedMemoryResponseDto> {
    return this.sharedMemoriesService.update(memoryId, dto);
  }

  @Delete(':memoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('memoryId') memoryId: string): Promise<void> {
    await this.sharedMemoriesService.remove(memoryId);
  }
}
