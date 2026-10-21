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
} from '@nestjs/common';
import { ProvidersService } from './providers.service.js';
import {
  CreateProviderDto,
  ListProvidersQueryDto,
  UpdateProviderDto,
} from './dto/provider.dto.js';

/**
 * REST resource for AI provider configurations.
 *
 * A provider represents a configured connection to an AI service — hosted
 * (Anthropic, OpenAI, Google) or local (Ollama, LM Studio) — and is the root
 * of the provider → model → credential hierarchy. Nothing in Glassbeetle can
 * call a model until a provider exists.
 *
 * ### Cascade on delete
 * Deleting a provider destroys:
 * - every **model** that belongs to it (`ON DELETE CASCADE`);
 * - the **credential** row, including the encrypted API key and its nonce —
 *   the key is unrecoverable once deleted;
 * - any **agent** whose `modelId` pointed at one of the deleted models has
 *   `modelId` set to `null` (`ON DELETE SET NULL`) and will be unable to run
 *   until reassigned.
 *
 * ### Credentials
 * Credential values are never readable or writable through these endpoints.
 * Use `GET|PUT|DELETE /api/v1/providers/:providerId/credential` instead.
 *
 * ### No outbound calls
 * Creating or updating a provider only stores configuration. No connectivity
 * check or API call is made to the provider at any point.
 */
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  /**
   * List providers.
   *
   * Returns an empty collection when there are none. Supports filtering by
   * `kind`, `enabled`, and `isLocal`, plus `sort`, `order`, `limit`, and
   * `offset` for pagination.
   */
  @Get()
  findAll(@Query() query: ListProvidersQueryDto) {
    return this.providersService.findAll(query);
  }

  /**
   * Create a provider.
   *
   * `baseUrl` is required when `kind` is `ollama`, `lmstudio`, or
   * `openai_compatible`. For `anthropic`, `openai`, and `google` it is an
   * optional endpoint override. Returns 400 for invalid input.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProviderDto) {
    return this.providersService.create(dto);
  }

  /**
   * Retrieve a single provider by ID.
   *
   * Returns 404 when no provider with that ID exists.
   */
  @Get(':providerId')
  findOne(@Param('providerId') providerId: string) {
    return this.providersService.findOne(providerId);
  }

  /**
   * Partially update a provider.
   *
   * Only the fields present in the request body are changed; all others are
   * left untouched. Returns 400 for invalid input, 404 when not found.
   */
  @Patch(':providerId')
  update(
    @Param('providerId') providerId: string,
    @Body() dto: UpdateProviderDto,
  ) {
    return this.providersService.update(providerId, dto);
  }

  /**
   * Delete a provider.
   *
   * The delete cascades to models and credentials; agents that referenced
   * deleted models have their `modelId` set to `null`. Returns 204 on
   * success, 404 when not found.
   */
  @Delete(':providerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('providerId') providerId: string): void {
    this.providersService.remove(providerId);
  }
}
