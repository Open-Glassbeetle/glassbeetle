import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService, type HealthStatus } from './app.service.js';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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

  @Get('health')
  @ApiOperation({
    summary: 'Service health',
    description:
      'Reports whether the API is running and for how long. Dependency readiness checks are not yet included.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['status', 'service', 'uptimeSeconds', 'timestamp'],
      properties: {
        status: { type: 'string', enum: ['ok'], example: 'ok' },
        service: { type: 'string', example: 'glassbeetle-api' },
        uptimeSeconds: { type: 'integer', example: 42 },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }
}
