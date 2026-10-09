import { ApiProperty } from '@nestjs/swagger';

/**
 * Response payload returned upon successful bulk deletion.
 *
 * Returns the count of deleted records so clients can confirm
 * how many records were permanently removed.
 */
export class BulkDeleteResponseDto {
  @ApiProperty({
    description: 'The number of records permanently deleted',
    example: 42,
  })
  readonly deleted!: number;
}
