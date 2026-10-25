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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../../common/http/api-error.js';
import { ModelsService } from '../models/models.service.js';
import {
  DiscoverModelsDto,
  ListProviderModelsQueryDto,
  ModelDiscoverySummaryDto,
  ModelDto,
  PaginatedModelsResponseDto,
  RegisterModelDto,
} from '../models/dto/index.js';

/**
 * Controller for `/providers/:providerId/models`.
 *
 * Exposes provider-scoped model listing, manual registration, and automated
 * model discovery with reconciliation.
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

  /**
   * Discovers and reconciles models for a provider.
   *
   * Queries the provider's remote API for available models and reconciles the
   * response into the models table:
   * - New models are inserted with source = 'discovered'.
   * - Existing discovered models have metadata updated and are enabled.
   * - Manually registered models are preserved untouched.
   * - Models absent upstream are marked disabled (enabled = 0) to avoid breaking agent references.
   */
  @Post('discover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Discover and reconcile models for a provider',
    description:
      "Queries the provider's remote API for its available models and reconciles them into the models table. Inserts newly discovered models, updates existing discovered models, leaves manual models untouched, and disables missing models without breaking agent references.",
  })
  @ApiParam({
    name: 'providerId',
    description: 'Provider identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiOkResponse({
    description: 'Model discovery completed and models reconciled',
    type: ModelDiscoverySummaryDto,
  })
  @ApiBadRequestResponse({
    description:
      'Provider is not configured for discovery (e.g. missing baseUrl for local/custom kind or missing credentials for hosted kind)',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Provider does not exist',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_IMPLEMENTED,
    description: 'Provider kind does not support model discovery',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    description:
      'Provider was reached but returned an error or malformed response',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.GATEWAY_TIMEOUT,
    description: 'Provider did not respond within the configured timeout',
    type: ApiErrorResponseDto,
  })
  discover(
    @Param('providerId') providerId: string,
    @Body() dto?: DiscoverModelsDto,
  ): Promise<ModelDiscoverySummaryDto> {
    return this.modelsService.discover(providerId, dto);
  }
}
