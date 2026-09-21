import {
  fromDbBoolean,
  parseJsonColumn,
  serializeJsonColumn,
  toDbBoolean,
} from './row-mapping.js';

describe('row mapping', () => {
  describe('booleans', () => {
    it('stores booleans as SQLite integers', () => {
      expect(toDbBoolean(true)).toBe(1);
      expect(toDbBoolean(false)).toBe(0);
    });

    it.each([
      [1, true],
      [0, false],
      [null, false],
      [undefined, false],
      [true, true],
      [false, false],
    ])('reads %p back as %p', (stored, expected) => {
      expect(fromDbBoolean(stored as number | boolean | null | undefined)).toBe(
        expected,
      );
    });

    it('round-trips in both directions', () => {
      expect(fromDbBoolean(toDbBoolean(true))).toBe(true);
      expect(fromDbBoolean(toDbBoolean(false))).toBe(false);
    });
  });

  describe('JSON columns', () => {
    it('serialises arrays and objects', () => {
      expect(serializeJsonColumn(['project-x', 'preference'])).toBe(
        '["project-x","preference"]',
      );
      expect(serializeJsonColumn({ topP: 0.9 })).toBe('{"topP":0.9}');
    });

    it.each([null, undefined])(
      'collapses %p to a single null representation',
      (value) => {
        expect(serializeJsonColumn(value)).toBeNull();
      },
    );

    it('round-trips a tags array', () => {
      const tags = ['project-x', 'preference'];

      expect(parseJsonColumn(serializeJsonColumn(tags), [])).toEqual(tags);
    });

    it.each([null, undefined, ''])('falls back for %p', (stored) => {
      expect(parseJsonColumn(stored as string | null | undefined, [])).toEqual(
        [],
      );
    });

    it('falls back rather than throwing when a column holds invalid JSON', () => {
      // A single malformed row must not be able to fail the whole list request
      // that read it.
      expect(parseJsonColumn('{not json', ['fallback'])).toEqual(['fallback']);
    });

    it('preserves an explicitly stored empty array', () => {
      expect(parseJsonColumn(serializeJsonColumn([]), ['fallback'])).toEqual(
        [],
      );
    });
  });
});
