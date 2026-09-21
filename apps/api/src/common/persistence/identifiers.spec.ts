import { newId } from './identifiers.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('produces a canonical UUIDv7 with the correct version and variant bits', () => {
    expect(newId()).toMatch(UUID_PATTERN);
  });

  it('produces unique identifiers', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId()));

    expect(ids.size).toBe(10_000);
  });

  it('sorts lexicographically in creation order across milliseconds', async () => {
    const first = newId();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = newId();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const third = newId();

    expect([third, first, second].sort()).toEqual([first, second, third]);
  });

  it('encodes the current time in the leading 48 bits', () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();

    const timestamp = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});
