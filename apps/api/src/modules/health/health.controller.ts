import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService, type HealthStatus } from './health.service.js';

/**
 * Routes for `/health`: the readiness probe the desktop shell waits on.
 *
 * The one unauthenticated endpoint whose status code carries meaning beyond
 * success or failure, which is why it is also the endpoint `npm run dev`
 * polls before launching the Tauri window.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * `GET /health` — current health and dependency readiness.
   *
   * Always returns the full report as the body; only the status code differs,
   * 200 when every check is `up` and 503 otherwise. A probe can therefore read
   * the code alone, while a human gets the reason without a second request.
   *
   * Overriding the status is why this handler takes the response object;
   * `passthrough: true` leaves Nest to serialise the body.
   */
  @Get()
  @ApiOperation({
    summary: 'Service health',
    description:
      'Reports backend service health and dependency readiness (200 when healthy, 503 when degraded).',
  })
  @ApiOkResponse({
    description: 'Service is healthy.',
    schema: {
      type: 'object',
      required: ['status', 'service', 'uptimeSeconds', 'timestamp', 'checks'],
      properties: {
        status: { type: 'string', enum: ['ok', 'degraded'], example: 'ok' },
        service: { type: 'string', example: 'glassbeetle-api' },
        uptimeSeconds: { type: 'integer', example: 42 },
        timestamp: { type: 'string', format: 'date-time' },
        checks: {
          type: 'object',
          required: ['database', 'storage'],
          properties: {
            database: {
              type: 'object',
              required: ['status'],
              properties: {
                status: {
                  type: 'string',
                  enum: ['up', 'down', 'not_configured'],
                  example: 'up',
                },
                error: { type: 'string', example: 'Connection failed' },
              },
            },
            storage: {
              type: 'object',
              required: ['status'],
              description:
                'Whether the file storage root exists and is writable by the API process.',
              properties: {
                status: {
                  type: 'string',
                  enum: ['up', 'down', 'not_configured'],
                  example: 'up',
                },
                error: {
                  type: 'string',
                  example: 'Storage root is not writable (EACCES)',
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description:
      'Service is degraded (one or more dependency readiness checks failed).',
  })
  async getHealth(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthStatus> {
    const health = await this.healthService.getHealth();
    if (health.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return health;
  }
}
