import { describe, expect, it } from 'vitest';
import { periodWindow } from './period-window.js';

/** Reads an instant back as a wall-clock string in a zone, for assertions. */
function wallClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

describe('periodWindow', () => {
  describe('in UTC', () => {
    const now = new Date('2026-10-08T14:30:00.000Z');

    it('runs a daily window from midnight to midnight', () => {
      expect(periodWindow('daily', now, 'UTC')).toEqual({
        start: '2026-10-08T00:00:00.000Z',
        end: '2026-10-09T00:00:00.000Z',
      });
    });

    it('runs a weekly window from Monday to Monday', () => {
      // 2026-10-08 is a Thursday.
      expect(periodWindow('weekly', now, 'UTC')).toEqual({
        start: '2026-10-05T00:00:00.000Z',
        end: '2026-10-12T00:00:00.000Z',
      });
    });

    it('starts the week on Monday when today is Sunday, not the day after', () => {
      expect(
        periodWindow('weekly', new Date('2026-10-11T23:59:00.000Z'), 'UTC'),
      ).toEqual({
        start: '2026-10-05T00:00:00.000Z',
        end: '2026-10-12T00:00:00.000Z',
      });
    });

    it('keeps Monday itself at the start of its own week', () => {
      expect(
        periodWindow('weekly', new Date('2026-10-05T00:00:00.000Z'), 'UTC'),
      ).toEqual({
        start: '2026-10-05T00:00:00.000Z',
        end: '2026-10-12T00:00:00.000Z',
      });
    });

    it('runs a monthly window over the calendar month', () => {
      expect(periodWindow('monthly', now, 'UTC')).toEqual({
        start: '2026-10-01T00:00:00.000Z',
        end: '2026-11-01T00:00:00.000Z',
      });
    });

    it('rolls a December budget into January', () => {
      expect(
        periodWindow('monthly', new Date('2026-12-20T12:00:00.000Z'), 'UTC'),
      ).toEqual({
        start: '2026-12-01T00:00:00.000Z',
        end: '2027-01-01T00:00:00.000Z',
      });
    });

    it('ends February on the right day in a leap year', () => {
      expect(
        periodWindow('monthly', new Date('2028-02-15T12:00:00.000Z'), 'UTC'),
      ).toEqual({
        start: '2028-02-01T00:00:00.000Z',
        end: '2028-03-01T00:00:00.000Z',
      });
    });
  });

  describe('in the user time zone', () => {
    it('starts the day at local midnight, not at UTC midnight', () => {
      // 01:30 in Zurich on the 8th is still 23:30 UTC on the 7th. A UTC-based
      // window would say the budget had already reset.
      const window = periodWindow(
        'daily',
        new Date('2026-10-07T23:30:00.000Z'),
        'Europe/Zurich',
      );

      expect(window.start).toBe('2026-10-07T22:00:00.000Z');
      expect(wallClock(window.start, 'Europe/Zurich')).toBe('2026-10-08 00:00');
      expect(wallClock(window.end, 'Europe/Zurich')).toBe('2026-10-09 00:00');
    });

    it('starts the month at local midnight', () => {
      const window = periodWindow(
        'monthly',
        new Date('2026-10-08T14:30:00.000Z'),
        'Europe/Zurich',
      );

      expect(wallClock(window.start, 'Europe/Zurich')).toBe('2026-10-01 00:00');
      expect(wallClock(window.end, 'Europe/Zurich')).toBe('2026-11-01 00:00');
    });

    it('works west of UTC too', () => {
      // 20:00 in New York on the 8th is 00:00 UTC on the 9th.
      const window = periodWindow(
        'daily',
        new Date('2026-10-09T00:00:00.000Z'),
        'America/New_York',
      );

      expect(wallClock(window.start, 'America/New_York')).toBe(
        '2026-10-08 00:00',
      );
      expect(wallClock(window.end, 'America/New_York')).toBe(
        '2026-10-09 00:00',
      );
    });

    it('handles a zone on a half-hour offset', () => {
      const window = periodWindow(
        'daily',
        new Date('2026-10-08T14:30:00.000Z'),
        'Asia/Kolkata',
      );

      expect(wallClock(window.start, 'Asia/Kolkata')).toBe('2026-10-08 00:00');
      expect(window.start).toBe('2026-10-07T18:30:00.000Z');
    });
  });

  describe('across a daylight-saving change', () => {
    it('keeps the month boundaries at local midnight when the clocks go back mid-month', () => {
      // Europe/Zurich leaves summer time on 2026-10-25, so the month starts on
      // a +02:00 offset and ends on a +01:00 one. A single offset applied to
      // both ends would put one of them an hour out.
      const window = periodWindow(
        'monthly',
        new Date('2026-10-28T12:00:00.000Z'),
        'Europe/Zurich',
      );

      expect(window.start).toBe('2026-09-30T22:00:00.000Z');
      expect(window.end).toBe('2026-10-31T23:00:00.000Z');
      expect(wallClock(window.start, 'Europe/Zurich')).toBe('2026-10-01 00:00');
      expect(wallClock(window.end, 'Europe/Zurich')).toBe('2026-11-01 00:00');
    });

    it('makes the week containing a spring-forward 167 hours long, not 168', () => {
      // Europe/Zurich enters summer time on Sunday 2026-03-29, which falls in
      // the week beginning Monday the 23rd. That week is an hour short, and a
      // window computed from a fixed offset would run an hour past its Monday.
      const window = periodWindow(
        'weekly',
        new Date('2026-03-25T12:00:00.000Z'),
        'Europe/Zurich',
      );
      const hours =
        (new Date(window.end).getTime() - new Date(window.start).getTime()) /
        3_600_000;

      expect(hours).toBe(167);
      expect(wallClock(window.start, 'Europe/Zurich')).toBe('2026-03-23 00:00');
      expect(wallClock(window.end, 'Europe/Zurich')).toBe('2026-03-30 00:00');
    });

    it('leaves the week after a transition a full 168 hours', () => {
      const window = periodWindow(
        'weekly',
        new Date('2026-03-31T12:00:00.000Z'),
        'Europe/Zurich',
      );
      const hours =
        (new Date(window.end).getTime() - new Date(window.start).getTime()) /
        3_600_000;

      expect(hours).toBe(168);
    });

    it('still reports local midnight for a day that follows a transition', () => {
      const window = periodWindow(
        'daily',
        new Date('2026-03-29T12:00:00.000Z'),
        'Europe/Zurich',
      );

      expect(wallClock(window.start, 'Europe/Zurich')).toBe('2026-03-29 00:00');
      expect(wallClock(window.end, 'Europe/Zurich')).toBe('2026-03-30 00:00');
    });
  });

  describe('when the zone is unusable', () => {
    it.each([null, undefined, '', 'Mars/Olympus_Mons'])(
      'falls back to UTC for %o rather than failing the request',
      (zone) => {
        expect(
          periodWindow('daily', new Date('2026-10-08T14:30:00.000Z'), zone),
        ).toEqual({
          start: '2026-10-08T00:00:00.000Z',
          end: '2026-10-09T00:00:00.000Z',
        });
      },
    );
  });

  describe('the window is half-open', () => {
    it('hands the instant a period ends on to the next period', () => {
      const first = periodWindow(
        'daily',
        new Date('2026-10-08T12:00:00.000Z'),
        'UTC',
      );
      const second = periodWindow('daily', new Date(first.end), 'UTC');

      expect(second.start).toBe(first.end);
    });
  });
});
