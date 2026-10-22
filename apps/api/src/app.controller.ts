import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';

/**
 * Serves the unversioned service banner at the API root.
 *
 * Unlike the feature controllers this one declares no path segment, so it
 * answers `/api` itself. It exists so that hitting the base URL returns
 * something meaningful instead of a 404; real health reporting lives in
 * `HealthModule`.
 */
@ApiTags('application')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Returns the service name as a bare string.
   *
   * @returns The literal service banner, `'Glassbeetle API'`.
   */
  @Get()
  @ApiOperation({
    summary: 'Service banner',
    description:
      'Returns the service name. Useful as a trivial liveness probe.',
  })
  @ApiOkResponse({ schema: { type: 'string', example: 'Glassbeetle API' } })
  getHello(): string {
    return this.appService.getHello();
  }
}
