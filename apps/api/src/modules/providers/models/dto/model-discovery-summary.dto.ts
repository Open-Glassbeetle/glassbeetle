import { ApiProperty } from '@nestjs/swagger';
import { ModelDto } from './model.dto.js';

/**
 * Summary returned by `POST /api/v1/providers/:providerId/models/discover`.
 *
 * Reports the outcome of reconciling remote provider models with the local
 * database, detailing counts of newly added, updated, unchanged, and disabled
 * models alongside the full list of models for the provider.
 */
export class ModelDiscoverySummaryDto {
  /**
   * Number of newly discovered models inserted into the database.
   */
  @ApiProperty({
    description: 'Number of newly discovered models inserted into the database',
    example: 3,
  })
  added!: number;

  /**
   * Number of existing discovered models whose metadata was updated.
   */
  @ApiProperty({
    description:
      'Number of existing discovered models whose metadata was updated',
    example: 1,
  })
  updated!: number;

  /**
   * Number of existing models whose metadata was already up-to-date and left unchanged.
   */
  @ApiProperty({
    description:
      'Number of existing models whose metadata was already up-to-date and left unchanged',
    example: 12,
  })
  unchanged!: number;

  /**
   * Number of previously-discovered models no longer offered upstream that were disabled (enabled = 0).
   *
   * Disabling rather than deleting preserves references from `agents.model_id`.
   */
  @ApiProperty({
    description:
      'Number of previously-discovered models no longer offered upstream that were disabled (enabled = 0)',
    example: 0,
  })
  disabled!: number;

  /**
   * All current models belonging to this provider after reconciliation.
   */
  @ApiProperty({
    description:
      'All current models belonging to this provider after reconciliation',
    type: [ModelDto],
  })
  models!: ModelDto[];
}
