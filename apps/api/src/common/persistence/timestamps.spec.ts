import { fromIso, nowIso, toIso } from './timestamps.js';

const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('timestamps', () => {
  describe('nowIso', () => {
    it('formats the current time as ISO-8601 UTC with millisecond precision', () => {
      expect(nowIso()).toMatch(ISO_UTC_MS);
    });
  });

  describe('toIso', () => {
    it('always formats in UTC regardless of the input offset', () => {
      expect(toIso(new Date('2026-09-21T11:30:52.123+02:00'))).toBe(
        '2026-09-21T09:30:52.123Z',
      );
    });

    it('rejects an invalid date rather than emitting "Invalid Date"', () => {
      expect(() => toIso(new Date('not a date'))).toThrow(TypeError);
    });
  });

  describe('fromIso', () => {
    it('round-trips a stored timestamp', () => {
      const original = new Date('2026-09-21T09:30:52.123Z');

      expect(fromIso(toIso(original))?.getTime()).toBe(original.getTime());
    });

    it.each([null, undefined, '', 'not a timestamp'])(
      'returns null for %p instead of throwing',
      (value) => {
        expect(fromIso(value as string | null | undefined)).toBeNull();
      },
    );
  });

  it('orders lexicographically in the same direction as chronologically', () => {
    const earlier = toIso(new Date('2026-01-09T23:59:59.999Z'));
    const later = toIso(new Date('2026-01-10T00:00:00.000Z'));

    // SQLite compares TEXT lexicographically, so this ordering is what makes
    // `ORDER BY created_at` correct without any conversion.
    expect(earlier < later).toBe(true);
  });
});
