import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../../common/http/api-error.js';
import { ModelsService } from '../models/models.service.js';
import {
  ListProviderModelsQueryDto,
  ModelDto,
  PaginatedModelsResponseDto,
  RegisterModelDto,
} from '../models/dto/index.js';

/**
 * Controller for `/providers/:providerId/models`.
 *
 * Exposes provider-scoped model listing and manual registration.
 */
@ApiTags('providers', 'models')
@Controller('providers/:providerId/models')
export class ProviderModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  /**
   * List models for a provider.
   *
   * Returns an empty collection with 200 when there are no models.
   * Supports filtering by `enabled` and `source`, plus pagination and sorting.
   */
  @Get()
  @ApiOperation({
    summary: "List a provider's models",
    description:
      "Returns a paginated list of models belonging to the specified provider. Supports filtering by enabled status and source ('discovered' vs 'manual'), plus sorting and pagination. Returns 404 if the provider does not exist.",
  })
  @ApiParam({
    name: 'providerId',
    description: 'Provider identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiOkResponse({
    description: 'Paginated collection of models for this provider',
    type: PaginatedModelsResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid query parameters (e.g. invalid sort column or filter values)',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Provider does not exist',
    type: ApiErrorResponseDto,
  })
  list(
    @Param('providerId') providerId: string,
    @Query() query: ListProviderModelsQueryDto,
  ): PaginatedModelsResponseDto {
    return this.modelsService.listByProvider(providerId, query);
  }

  /**
   * Manually register a model for a provider.
   *
   * Always sets `source` to `'manual'`. Returns 400 if validation fails or
   * if client attempts to supply `providerId` or `source` in the body.
   * Returns 404 if the provider does not exist.
   * Returns 409 if a model with that identifier already exists for this provider.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Manually register a model for a provider',
    description:
      "Registers a new model manually under the specified provider. The source column is always set to 'manual'. Returns 400 if validation fails or if client attempts to supply providerId/source in the body. Returns 404 if the provider does not exist. Returns 409 if a model with the same modelIdentifier already exists for this provider.",
  })
  @ApiParam({
    name: 'providerId',
    description: 'Provider identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiCreatedResponse({
    description: 'The registered model',
    type: ModelDto,
  })
  @ApiBadRequestResponse({
    description:
      'Validation failure (e.g. missing required fields, negative bounds, or client-supplied providerId/source)',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Provider does not exist',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'A model with that modelIdentifier already exists for this provider',
    type: ApiErrorResponseDto,
  })
  create(
    @Param('providerId') providerId: string,
    @Body() dto: RegisterModelDto,
  ): ModelDto {
    return this.modelsService.createManual(providerId, dto);
  }
}
