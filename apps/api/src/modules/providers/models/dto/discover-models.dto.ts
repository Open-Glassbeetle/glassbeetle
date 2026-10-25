import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Optional request body accepted by `POST /api/v1/providers/:providerId/models/discover`.
 */
export class DiscoverModelsDto {
  /**
   * Timeout in milliseconds for remote provider discovery.
   *
   * Defaults to 10000ms (10 seconds) if unspecified.
   */
  @ApiPropertyOptional({
    description:
      'Timeout in milliseconds for remote provider discovery. Defaults to 10000ms.',
    example: 10000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timeoutMs?: number;
}
