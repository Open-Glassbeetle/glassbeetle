import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { UserService } from '../user/user.service.js';
import { BudgetService } from './budget.service.js';

const NOW = new Date('2026-10-08T14:30:00.000Z');

describe('BudgetService', () => {
  let db: DatabaseService;
  let users: UserService;
  let service: BudgetService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    users = new UserService(db);
    service = new BudgetService(db, users);
  });

  afterEach(() => {
    db.close();
  });

  function budgetRows(): Array<Record<string, unknown>> {
    return db.all('SELECT * FROM spend_budget');
  }

  /** Records a chargeable usage event, as inference eventually will. */
  function recordCall(occurredAt: string, costUsd: number | null): void {
    db.run(
      `INSERT INTO usage_events (id, occurred_at, event_type, cost_usd)
       VALUES (?, ?, 'chat_completion', ?)`,
      [
        `01a11c49-${Math.random().toString(16).slice(2, 10)}`,
        occurredAt,
        costUsd,
      ],
    );
  }

  describe('find', () => {
    it('provisions the budget on first read instead of reporting that none exists', async () => {
      expect(budgetRows()).toHaveLength(0);

      const budget = await service.find(NOW);

      expect(budget.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(budgetRows()).toHaveLength(1);
    });

    it('starts with no limit, so spending is reported before it is bounded', async () => {
      const budget = await service.find(NOW);

      expect(budget).toMatchObject({
        limitUsd: null,
        remainingUsd: null,
        usedFraction: null,
        period: 'monthly',
      });
    });

    it('reports an installation that has never run a completion as zero', async () => {
      const budget = await service.find(NOW);

      expect(budget.spentUsd).toBe(0);
      expect(budget.callCount).toBe(0);
    });

    it('never creates a second budget', async () => {
      await service.find(NOW);
      await service.find(NOW);

      expect(budgetRows()).toHaveLength(1);
    });

    it('does not provision a user profile as a side effect of reading the budget', async () => {
      await service.find(NOW);

      // A question about spending should not create the user.
      expect(db.all('SELECT * FROM user_profile')).toHaveLength(0);
    });
  });

  describe('spend', () => {
    beforeEach(async () => {
      await service.update({ limitUsd: 20 }, NOW);
    });

    it('sums the costs recorded inside the period', async () => {
      recordCall('2026-10-02T09:00:00.000Z', 1.5);
      recordCall('2026-10-07T23:59:59.999Z', 2.62);

      const budget = await service.find(NOW);

      expect(budget.spentUsd).toBe(4.12);
      expect(budget.remainingUsd).toBe(15.88);
      expect(budget.callCount).toBe(2);
    });

    it('ignores costs recorded before the period started', async () => {
      recordCall('2026-09-30T23:59:59.999Z', 99);

      const budget = await service.find(NOW);

      expect(budget.spentUsd).toBe(0);
      expect(budget.callCount).toBe(0);
    });

    it('ignores costs recorded after the period ends', async () => {
      recordCall('2026-11-01T00:00:00.000Z', 99);

      const budget = await service.find(NOW);

      expect(budget.spentUsd).toBe(0);
    });

    it('counts only the events that carry a cost, because usage_events also logs activity', async () => {
      recordCall('2026-10-02T09:00:00.000Z', 1.5);
      db.run(
        `INSERT INTO usage_events (id, occurred_at, event_type)
         VALUES (?, ?, 'agent_created')`,
        ['01a11c49-0000-7000-8000-000000000002', '2026-10-03T09:00:00.000Z'],
      );

      const budget = await service.find(NOW);

      expect(budget.callCount).toBe(1);
      expect(budget.spentUsd).toBe(1.5);
    });

    it('reports passing the budget rather than clamping at the limit', async () => {
      recordCall('2026-10-02T09:00:00.000Z', 25);

      const budget = await service.find(NOW);

      expect(budget.remainingUsd).toBe(-5);
      expect(budget.usedFraction).toBe(1.25);
    });

    it('follows the period when it changes, without touching the events', async () => {
      recordCall('2026-10-02T09:00:00.000Z', 10);
      recordCall('2026-10-08T09:00:00.000Z', 1);

      expect((await service.find(NOW)).spentUsd).toBe(11);

      const daily = await service.update({ period: 'daily' }, NOW);

      // Only the call made today is inside a daily window.
      expect(daily.spentUsd).toBe(1);
      expect(daily.periodStart).toBe('2026-10-08T00:00:00.000Z');
    });
  });

  describe('the period window', () => {
    it('runs over the calendar month in UTC when the profile has no time zone', async () => {
      const budget = await service.find(NOW);

      expect(budget.periodStart).toBe('2026-10-01T00:00:00.000Z');
      expect(budget.periodEnd).toBe('2026-11-01T00:00:00.000Z');
    });

    it("anchors the window to the user's own midnight", async () => {
      await users.update({ timezone: 'Europe/Zurich' });

      const budget = await service.find(NOW);

      // Midnight in Zurich on 1 October is 22:00 UTC on 30 September.
      expect(budget.periodStart).toBe('2026-09-30T22:00:00.000Z');
    });

    it('puts a call made late at night in the day the user is actually in', async () => {
      await users.update({ timezone: 'Europe/Zurich' });
      await service.update({ period: 'daily', limitUsd: 5 }, NOW);

      // 00:30 on the 9th in Zurich, which is still the 8th in UTC.
      recordCall('2026-10-08T22:30:00.000Z', 2);

      const budget = await service.find(new Date('2026-10-08T23:00:00.000Z'));

      expect(budget.spentUsd).toBe(2);
      expect(budget.periodStart).toBe('2026-10-08T22:00:00.000Z');
    });
  });

  describe('update', () => {
    it('sets a limit and reports what is left of it', async () => {
      const budget = await service.update({ limitUsd: 20 }, NOW);

      expect(budget).toMatchObject({
        limitUsd: 20,
        remainingUsd: 20,
        usedFraction: 0,
      });
    });

    it('persists what it returns', async () => {
      await service.update({ limitUsd: 20, period: 'weekly' }, NOW);

      const reread = await service.find(NOW);
      expect(reread.limitUsd).toBe(20);
      expect(reread.period).toBe('weekly');
    });

    it('provisions the budget when the update is the first request', async () => {
      await service.update({ limitUsd: 20 }, NOW);

      expect(budgetRows()).toHaveLength(1);
    });

    it('removes the limit on an explicit null, leaving spending reported', async () => {
      await service.update({ limitUsd: 20 }, NOW);
      recordCall('2026-10-02T09:00:00.000Z', 3);

      const budget = await service.update({ limitUsd: null }, NOW);

      expect(budget.limitUsd).toBeNull();
      expect(budget.remainingUsd).toBeNull();
      expect(budget.spentUsd).toBe(3);
    });

    it('treats an empty payload as a no-op and does not touch updatedAt', async () => {
      const before = await service.find(NOW);

      const after = await service.update({}, NOW);

      expect(after).toEqual(before);
    });

    it('never creates a second budget', async () => {
      await service.update({ limitUsd: 20 }, NOW);
      await service.update({ limitUsd: 30 }, NOW);

      expect(budgetRows()).toHaveLength(1);
    });
  });
});
