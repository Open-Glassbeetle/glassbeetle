import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@ApiTags('application')
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
}
