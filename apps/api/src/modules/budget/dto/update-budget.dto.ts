import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { BUDGET_PERIODS, type BudgetPeriod } from '../period-window.js';

/**
 * The largest limit the API accepts, in US dollars.
 *
 * Not a real constraint on anyone's spending — a ceiling that stops a slipped
 * decimal point or a pasted token count from being stored as a budget, and
 * keeps the value in a range that prints sensibly.
 */
export const MAX_LIMIT_USD = 1_000_000;

/**
 * Request payload for updating the budget (PATCH).
 *
 * There is no create payload: the budget is a singleton that `GET /budget`
 * provisions, so there is never a moment at which a client could create it.
 *
 * - Omitted (`undefined`): field is not modified.
 * - `limitUsd: null`: the budget is removed and spending is only reported.
 * - Empty body (`{}`): idempotent no-op (200 OK, `updatedAt` untouched).
 */
export class UpdateBudgetDto {
  @ApiPropertyOptional({
    type: Number,
    description:
      'The ceiling for one period, in US dollars. Null removes the budget and leaves spending reported but unbounded.',
    example: 20,
    minimum: 0.01,
    maximum: MAX_LIMIT_USD,
    nullable: true,
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'limitUsd must be an amount with at most two decimal places' },
  )
  @Min(0.01, { message: 'limitUsd must be at least 0.01' })
  @Max(MAX_LIMIT_USD, { message: `limitUsd must not exceed ${MAX_LIMIT_USD}` })
  limitUsd?: number | null;

  @ApiPropertyOptional({
    description: 'The period the limit applies to',
    enum: BUDGET_PERIODS,
    example: 'monthly',
  })
  // `@IsOptional()` would also admit `null`, and the column is NOT NULL: there
  // is no "no period" state to clear it to. A budget always runs on some
  // period, even when no limit is set.
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(BUDGET_PERIODS, {
    message: `period must be one of: ${BUDGET_PERIODS.join(', ')}`,
  })
  period?: BudgetPeriod;
}
