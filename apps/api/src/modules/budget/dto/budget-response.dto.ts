import { ApiProperty } from '@nestjs/swagger';
import { BUDGET_PERIODS, type BudgetPeriod } from '../period-window.js';

/**
 * Public API representation of the spending budget and the period it is in.
 *
 * The budget and the spend against it are one response rather than two
 * endpoints: every caller that wants one wants the other, and the window the
 * spend is summed over is a property of the budget. Splitting them would make
 * a client compute period boundaries itself, in its own time zone, and get a
 * different answer from the server's.
 *
 * Amounts are US dollars, because `usage_events.cost_usd` is. There is no
 * currency field: offering one would promise a conversion nothing in a
 * local-first application can perform offline.
 */
export class BudgetResponseDto {
  @ApiProperty({
    description: 'Unique budget identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly id!: string;

  @ApiProperty({
    type: Number,
    description:
      'The ceiling for one period, in US dollars, or null when no budget is set',
    example: 20,
    nullable: true,
  })
  readonly limitUsd!: number | null;

  @ApiProperty({
    description: 'The period the limit applies to',
    enum: BUDGET_PERIODS,
    example: 'monthly',
  })
  readonly period!: BudgetPeriod;

  @ApiProperty({
    description:
      'First instant of the current period, in ISO-8601 UTC. Anchored to local midnight in the time zone on the user profile.',
    example: '2026-10-01T00:00:00.000Z',
  })
  readonly periodStart!: string;

  @ApiProperty({
    description:
      'First instant of the next period, in ISO-8601 UTC. Exclusive: an event at this instant counts against the next period.',
    example: '2026-11-01T00:00:00.000Z',
  })
  readonly periodEnd!: string;

  @ApiProperty({
    description:
      'Total cost recorded in this period, in US dollars. Summed from `usage_events.cost_usd`.',
    example: 4.12,
  })
  readonly spentUsd!: number;

  @ApiProperty({
    type: Number,
    description:
      'What is left of the limit, in US dollars. Negative when the limit has been passed, and null when no limit is set.',
    example: 15.88,
    nullable: true,
  })
  readonly remainingUsd!: number | null;

  @ApiProperty({
    type: Number,
    description:
      'Spend as a fraction of the limit. Deliberately not clamped: a value above 1 is how a client learns the budget was exceeded. Null when no limit is set.',
    example: 0.206,
    nullable: true,
  })
  readonly usedFraction!: number | null;

  @ApiProperty({
    type: 'integer',
    description:
      'How many usage events in this period carry a cost. Zero means nothing chargeable has been recorded — which is the case for every installation until completions run.',
    example: 37,
  })
  readonly callCount!: number;

  @ApiProperty({
    description: 'Timestamp of budget creation in ISO-8601 UTC format',
    example: '2026-10-01T08:00:00.000Z',
  })
  readonly createdAt!: string;

  @ApiProperty({
    description: 'Timestamp of the last budget change in ISO-8601 UTC format',
    example: '2026-10-08T14:22:10.904Z',
  })
  readonly updatedAt!: string;
}

/**
 * Interface representation of the budget.
 */
export type BudgetResponse = Readonly<BudgetResponseDto>;
