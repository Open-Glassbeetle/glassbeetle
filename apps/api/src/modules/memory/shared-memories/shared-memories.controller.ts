import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
} from './dto/index.js';
import { SharedMemoriesService } from './shared-memories.service.js';

/**
 * Controller exposing collection endpoints for shared (global) memory.
 *
 * Endpoints:
 * - `GET /api/v1/memories`: Lists global shared memories with pagination, sorting, and filters.
 * - `POST /api/v1/memories`: Appends a new global shared memory.
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
}
