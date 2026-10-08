import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Budget endpoints (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
  });

  function budgetRows(): Array<Record<string, unknown>> {
    return testApp.db.all('SELECT * FROM spend_budget');
  }

  /** Records a chargeable usage event, as inference eventually will. */
  function recordCall(id: string, occurredAt: string, costUsd: number): void {
    testApp.db.run(
      `INSERT INTO usage_events (id, occurred_at, event_type, cost_usd)
       VALUES (?, ?, 'chat_completion', ?)`,
      [id, occurredAt, costUsd],
    );
  }

  describe('GET /api/v1/budget', () => {
    it('provisions the budget on first read rather than reporting that none exists', async () => {
      expect(budgetRows()).toHaveLength(0);

      const response = await testApp
        .request()
        .get('/api/v1/budget')
        .expect(200);

      expect(response.body).toMatchObject({
        limitUsd: null,
        period: 'monthly',
        spentUsd: 0,
        remainingUsd: null,
        usedFraction: null,
        callCount: 0,
      });
      expect(budgetRows()).toHaveLength(1);
    });

    it('reports a half-open period, so an event belongs to exactly one of them', async () => {
      const response = await testApp
        .request()
        .get('/api/v1/budget')
        .expect(200);

      expect(new Date(response.body.periodEnd).getTime()).toBeGreaterThan(
        new Date(response.body.periodStart).getTime(),
      );
    });

    it('never exposes the singleton column', async () => {
      const response = await testApp
        .request()
        .get('/api/v1/budget')
        .expect(200);

      expect(response.body.singleton).toBeUndefined();
    });

    it('emits the amounts that need a limit as null rather than omitting them', async () => {
      const response = await testApp
        .request()
        .get('/api/v1/budget')
        .expect(200);

      for (const field of ['limitUsd', 'remainingUsd', 'usedFraction']) {
        expect(field in response.body).toBe(true);
      }
    });
  });

  describe('PATCH /api/v1/budget', () => {
    it('sets a limit and reports what is left', async () => {
      const response = await testApp
        .request()
        .patch('/api/v1/budget')
        .send({ limitUsd: 20, period: 'weekly' })
        .expect(200);

      expect(response.body).toMatchObject({
        limitUsd: 20,
        period: 'weekly',
        remainingUsd: 20,
        usedFraction: 0,
      });

      const reread = await testApp.request().get('/api/v1/budget').expect(200);
      expect(reread.body.limitUsd).toBe(20);
    });

    it('removes the budget on an explicit null, leaving spending reported', async () => {
      await testApp
        .request()
        .patch('/api/v1/budget')
        .send({ limitUsd: 20 })
        .expect(200);

      const response = await testApp
        .request()
        .patch('/api/v1/budget')
        .send({ limitUsd: null })
        .expect(200);

      expect(response.body.limitUsd).toBeNull();
      expect(response.body.spentUsd).toBe(0);
    });

    it('treats an empty body as a no-op and leaves updatedAt alone', async () => {
      const before = await testApp.request().get('/api/v1/budget').expect(200);

      const response = await testApp
        .request()
        .patch('/api/v1/budget')
        .send({})
        .expect(200);

      expect(response.body.updatedAt).toBe(before.body.updatedAt);
    });

    it('rejects an unknown period with the error envelope', async () => {
      const response = await testApp
        .request()
        .patch('/api/v1/budget')
        .send({ period: 'fortnightly' })
        .expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        code: 'BAD_REQUEST',
        path: '/api/v1/budget',
      });
      expect(response.body.details.join(' ')).toContain(
        'period must be one of',
      );
    });

    it('rejects an amount with more precision than money has', async () => {
      await testApp
        .request()
        .patch('/api/v1/budget')
        .send({ limitUsd: 20.123 })
        .expect(400);
    });

    it.each([0, -5, 1_000_001])('rejects a limit of %o', async (limitUsd) => {
      await testApp
        .request()
        .patch('/api/v1/budget')
        .send({ limitUsd })
        .expect(400);
    });

    it('rejects server-managed fields rather than ignoring them', async () => {
      for (const payload of [
        { id: '018f3a9e-0000-7000-8000-000000000001' },
        { spentUsd: 0 },
        { remainingUsd: 10 },
        { periodStart: '2026-10-01T00:00:00.000Z' },
        { updatedAt: '2026-10-01T08:00:00.000Z' },
      ]) {
        await testApp
          .request()
          .patch('/api/v1/budget')
          .send(payload)
          .expect(400);
      }
    });
  });

  describe('spend against the usage log', () => {
    it('sums what was recorded inside the period and subtracts it from the limit', async () => {
      await testApp
        .request()
        .patch('/api/v1/budget')
        .send({ limitUsd: 20 })
        .expect(200);

      const period = (await testApp.request().get('/api/v1/budget').expect(200))
        .body;
      const inside = new Date(
        (new Date(period.periodStart).getTime() +
          new Date(period.periodEnd).getTime()) /
          2,
      ).toISOString();

      recordCall('01a11c49-0000-7000-8000-000000000001', inside, 1.5);
      recordCall('01a11c49-0000-7000-8000-000000000002', inside, 2.62);

      const response = await testApp
        .request()
        .get('/api/v1/budget')
        .expect(200);

      expect(response.body.spentUsd).toBe(4.12);
      expect(response.body.remainingUsd).toBe(15.88);
      expect(response.body.callCount).toBe(2);
    });

    it('ignores what was recorded outside the period', async () => {
      const period = (await testApp.request().get('/api/v1/budget').expect(200))
        .body;

      recordCall(
        '01a11c49-0000-7000-8000-000000000003',
        new Date(new Date(period.periodStart).getTime() - 1).toISOString(),
        99,
      );
      recordCall('01a11c49-0000-7000-8000-000000000004', period.periodEnd, 99);

      const response = await testApp
        .request()
        .get('/api/v1/budget')
        .expect(200);

      expect(response.body.spentUsd).toBe(0);
      expect(response.body.callCount).toBe(0);
    });

    it('reports passing the budget rather than clamping at the limit', async () => {
      await testApp
        .request()
        .patch('/api/v1/budget')
        .send({ limitUsd: 10 })
        .expect(200);

      const period = (await testApp.request().get('/api/v1/budget').expect(200))
        .body;
      recordCall(
        '01a11c49-0000-7000-8000-000000000005',
        period.periodStart,
        12.5,
      );

      const response = await testApp
        .request()
        .get('/api/v1/budget')
        .expect(200);

      expect(response.body.remainingUsd).toBe(-2.5);
      expect(response.body.usedFraction).toBe(1.25);
    });

    it("follows the user's time zone when it changes", async () => {
      const utc = (await testApp.request().get('/api/v1/budget').expect(200))
        .body;

      await testApp
        .request()
        .patch('/api/v1/user')
        .send({ timezone: 'Pacific/Auckland' })
        .expect(200);

      const zoned = (await testApp.request().get('/api/v1/budget').expect(200))
        .body;

      // Auckland is well ahead of UTC, so its month starts earlier in UTC terms.
      expect(zoned.periodStart).not.toBe(utc.periodStart);
      expect(new Date(zoned.periodStart).getTime()).toBeLessThan(
        new Date(utc.periodStart).getTime(),
      );
    });
  });

  describe('the budget is a singleton', () => {
    it('offers no way to create a second one', async () => {
      await testApp.request().post('/api/v1/budget').send({}).expect(404);
    });

    it('offers no way to delete it', async () => {
      await testApp.request().delete('/api/v1/budget').expect(404);
    });

    it('offers no budget addressable by id', async () => {
      await testApp
        .request()
        .get('/api/v1/budget/018f3a9e-0000-7000-8000-000000000001')
        .expect(404);
    });

    it('offers no budgets collection', async () => {
      await testApp.request().get('/api/v1/budgets').expect(404);
    });
  });
});
