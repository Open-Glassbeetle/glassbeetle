import { Injectable } from '@nestjs/common';
import { newId } from '../../common/persistence/identifiers.js';
import { nowIso } from '../../common/persistence/timestamps.js';
import { DatabaseService } from '../../database/database.service.js';
import { UserService } from '../user/user.service.js';
import type { BudgetResponseDto } from './dto/budget-response.dto.js';
import {
  applyBudgetUpdates,
  mapBudgetToResponse,
  type PeriodSpend,
  type SpendBudgetRow,
} from './dto/budget.mapper.js';
import type { UpdateBudgetDto } from './dto/update-budget.dto.js';
import { periodWindow, type PeriodWindow } from './period-window.js';

@Injectable()
export class BudgetService {
  constructor(
    private readonly db: DatabaseService,
    private readonly users: UserService,
  ) {}

  /**
   * The budget and what has been spent against it this period.
   */
  async find(now: Date = new Date()): Promise<BudgetResponseDto> {
    const row = this.readRow();
    const window = this.windowFor(row, now);

    return mapBudgetToResponse(row, window, this.spendIn(window));
  }

  /**
   * Changes the limit or the period.
   *
   * An empty body is an idempotent no-op: the response is the unchanged budget
   * with the current period's spend, and `updated_at` is left alone.
   */
  async update(
    dto: UpdateBudgetDto,
    now: Date = new Date(),
  ): Promise<BudgetResponseDto> {
    const existing = this.readRow();
    const result = applyBudgetUpdates(existing, dto);

    if (result.hasChanges) {
      this.db.run(
        `UPDATE spend_budget SET ${result.setClauses.join(', ')} WHERE id = ?`,
        [...result.setParams, existing.id],
      );
    }

    const row = result.updatedRow;
    const window = this.windowFor(row, now);

    return mapBudgetToResponse(row, window, this.spendIn(window));
  }

  /**
   * The window the budget's period puts this instant in.
   *
   * Anchored to the user's own midnight, which is the whole reason the profile
   * carries a time zone: a daily budget that renewed at UTC midnight would
   * reset in the middle of a Swiss afternoon.
   */
  private windowFor(row: SpendBudgetRow, now: Date): PeriodWindow {
    return periodWindow(row.period, now, this.users.timezone());
  }

  /**
   * What the usage log says was spent inside a window.
   *
   * `usage_events` is an activity log rather than a cost log — it also records
   * things like an agent being created — so the count is of the events that
   * carry a cost, not of every row. A period with nothing chargeable in it
   * reports zero and zero, which is exactly what an installation whose
   * completions do not run yet should see.
   */
  private spendIn(window: PeriodWindow): PeriodSpend {
    const row = this.db.get<{ spent: number | null; calls: number }>(
      `SELECT COALESCE(SUM(cost_usd), 0) AS spent,
              COUNT(cost_usd)            AS calls
         FROM usage_events
        WHERE occurred_at >= ? AND occurred_at < ?`,
      [window.start, window.end],
    );

    return { spentUsd: row?.spent ?? 0, callCount: row?.calls ?? 0 };
  }

  /**
   * Reads the single budget row, creating it if the database has none yet.
   *
   * Provisioned on read for the same reason the user profile is: there is no
   * step in which a user sets the application up, so no endpoint may answer
   * "that does not exist yet" for something every installation has. A fresh
   * row has no limit, which reports spending without bounding it.
   */
  private readRow(): SpendBudgetRow {
    return this.db.transaction(() => {
      const timestamp = nowIso();

      this.db.run(
        `INSERT INTO spend_budget (id, singleton, limit_usd, period, created_at, updated_at)
         VALUES (?, 1, NULL, 'monthly', ?, ?)
         ON CONFLICT (singleton) DO NOTHING`,
        [newId(), timestamp, timestamp],
      );

      const row = this.db.get<SpendBudgetRow>(
        'SELECT * FROM spend_budget WHERE singleton = 1',
      );

      if (!row) {
        // Unreachable: the insert above either wrote this row or found it.
        throw new Error('The spending budget could not be provisioned');
      }

      return row;
    });
  }
}
