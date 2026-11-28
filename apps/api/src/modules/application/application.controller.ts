import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../common/http/api-error.js';
import { ApplicationService } from './application.service.js';
import {
  ResetApplicationDto,
  ResetApplicationQueryDto,
  ResetApplicationResponseDto,
} from './dto/index.js';

/**
 * Controller exposing application-lifecycle endpoints (`/application`).
 */
@ApiTags('application')
@Controller('application')
export class ApplicationController {
  constructor(private readonly applicationService: ApplicationService) {}

  /**
   * Resets the application to a clean, freshly-installed state.
   */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset the application to a clean, freshly-installed state',
    description: `Returns the application to a clean, freshly-installed state.

### Destructive Operation
This endpoint permanently clears user data across the application:
- **Cleared**: Agents, chats, messages, memories (agent & shared), teams, projects, artifacts, system prompts, and usage analytics events.
- **Cleared Files**: Associated stored files (profile pictures, project cover images, artifact files) are unlinked from disk.
- **Preserved by Default**: Backup metadata and backup archives on disk are **preserved** (\`keepBackups: true\`), ensuring you can restore past states.
- **Preserved**: The encryption master key (\`master.key\`) is preserved.
- **Reset to Defaults**: The backup policy (\`backup_policy\` id=1), user profile (\`user_profile\`), and spend budget (\`spend_budget\`) are reset to default seed values.

### Options
- \`keepProviders\` (boolean, default: false): Preserve configured providers, models, and provider credentials.
- \`keepBackups\` (boolean, default: true): Preserve backup records and archive files.
- \`createBackup\` (boolean, default: false): Generate an automatic safety backup archive before resetting.

### Confirmation Requirement
Explicit confirmation is mandatory. Supply \`?confirm=true\` (or \`?confirm=RESET\`) as a query parameter or pass \`{ "confirm": "true" }\` (or \`{ "confirm": "RESET" }\`) in the request body.`,
  })
  @ApiBody({
    type: ResetApplicationDto,
    required: false,
    description:
      'Reset options and confirmation. Confirmation can alternatively be supplied via `?confirm=true` or `?confirm=RESET` query parameter.',
  })
  @ApiOkResponse({
    description: 'Application reset completed successfully',
    type: ResetApplicationResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Confirmation is missing or invalid, or invalid options were provided',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'A backup, restore, or reset operation is currently in progress',
    type: ApiErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description:
      'Reset failed; active database changes were rolled back and application state was preserved',
    type: ApiErrorResponseDto,
  })
  async reset(
    @Body() body?: ResetApplicationDto,
    @Query() query?: ResetApplicationQueryDto,
  ): Promise<ResetApplicationResponseDto> {
    const rawConfirm = body?.confirm ?? query?.confirm;
    const confirm =
      typeof rawConfirm === 'string' ? rawConfirm.trim() : rawConfirm;

    if (confirm !== 'true' && confirm !== 'RESET') {
      throw new BadRequestException({
        code: 'CONFIRMATION_REQUIRED',
        message:
          'Explicit confirmation is required to reset the application (confirm must be "true" or "RESET")',
      });
    }

    return this.applicationService.reset(Object.assign({}, body, { confirm }));
  }
}
