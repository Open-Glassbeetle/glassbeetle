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
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import {
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
