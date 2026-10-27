import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../../common/http/api-error.js';
import { ModelsService } from './models.service.js';
import {
  ListModelsQueryDto,
  ModelDto,
  PaginatedModelsResponseDto,
  UpdateModelDto,
} from './dto/index.js';

/**
 * Controller for `/models`: the global, provider-independent model endpoints.
 *
 * Exposes listing every configured model across all providers, and retrieving,
 * updating, or deleting a model by ID.
 *
 * Counterpart to ProviderModelsController (`/providers/:providerId/models`), which
 * serves provider-scoped routes (creation/registration and discovery).
 */
@ApiTags('models')
@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  /**
   * `GET /models` — list all models across all providers.
   */
  @Get()
  @ApiOperation({
    summary: 'List all models',
    description:
      'Returns a paginated list of models across all providers. Supports filtering by providerId, enabled status, and source, plus sorting and pagination.',
  })
  @ApiOkResponse({
    description: 'Paginated collection of models across providers',
    type: PaginatedModelsResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid query parameters (e.g. invalid sort column or filter value)',
    type: ApiErrorResponseDto,
  })
  findAll(@Query() query: ListModelsQueryDto): PaginatedModelsResponseDto {
    return this.modelsService.listAll(query);
  }

  /**
   * `GET /models/:modelId` — retrieve a single model by ID.
   */
  @Get(':modelId')
  @ApiOperation({
    summary: 'Retrieve a model',
    description:
      'Returns a single model resource by its unique identifier (UUIDv7).',
  })
  @ApiParam({
    name: 'modelId',
    description: 'Unique model identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiOkResponse({
    description: 'The requested model',
    type: ModelDto,
  })
  @ApiNotFoundResponse({
    description: 'Model does not exist',
    type: ApiErrorResponseDto,
  })
  findOne(@Param('modelId') modelId: string): ModelDto {
    return this.modelsService.findOne(modelId);
  }

  /**
   * `PATCH /models/:modelId` — partially update a model.
   */
  @Patch(':modelId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a model',
    description:
      'Partially updates a model resource (displayName, contextWindow, defaultTemperature, defaultMaxTokens, enabled). providerId, modelIdentifier, and source are immutable and cannot be updated. Returns 400 on validation failure or if immutable fields are supplied. Returns 404 if the model does not exist.',
  })
  @ApiParam({
    name: 'modelId',
    description: 'Unique model identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiOkResponse({
    description: 'The updated model',
    type: ModelDto,
  })
  @ApiBadRequestResponse({
    description:
      'Validation failure or attempt to update immutable fields (providerId, modelIdentifier, source)',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Model does not exist',
    type: ApiErrorResponseDto,
  })
  update(
    @Param('modelId') modelId: string,
    @Body() dto: UpdateModelDto,
  ): ModelDto {
    return this.modelsService.update(modelId, dto);
  }

  /**
   * `DELETE /models/:modelId` — permanently delete a model.
   */
  @Delete(':modelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a model',
    description: `Permanently deletes a model resource.

Cascade behavior across referencing tables:
- \`agents\` (model_id nullable): SET NULL — dependent agents survive intact with modelId set to null, but can no longer run until reconfigured with a valid model. Consider disabling the model (PATCH with enabled = false) instead of deleting it if you wish to preserve agent references.
- \`usage_events\` (model_id nullable): SET NULL — historical analytics and telemetry records survive, attribution to this model is lost.`,
  })
  @ApiParam({
    name: 'modelId',
    description: 'Unique model identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiNoContentResponse({
    description: 'Model successfully deleted',
  })
  @ApiNotFoundResponse({
    description: 'Model does not exist',
    type: ApiErrorResponseDto,
  })
  delete(@Param('modelId') modelId: string): void {
    this.modelsService.delete(modelId);
  }
}

