import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService, type HealthStatus } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

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
          required: ['database'],
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
  getHealth(@Res({ passthrough: true }) res: Response): HealthStatus {
    const health = this.healthService.getHealth();
    if (health.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return health;
  }
}
