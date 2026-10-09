import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsNotEmpty } from 'class-validator';

/**
 * Query parameters for bulk deletion endpoints.
 *
 * Bulk deletion permanently and irreversibly clears memory records.
 * To guard against accidental invocations and cross-site requests,
 * callers must explicitly confirm destruction with `?confirm=true`.
 */
export class BulkDeleteQueryDto {
  @ApiProperty({
    description:
      'Safety confirmation flag. Must be explicitly set to "true" to authorize irreversible deletion.',
    example: 'true',
    type: String,
  })
  @IsNotEmpty({
    message: 'confirm query parameter is required',
  })
  @Equals('true', {
    message: 'confirm must be "true" to authorize irreversible deletion',
  })
  confirm!: string;
}
