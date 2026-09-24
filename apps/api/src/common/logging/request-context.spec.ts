import { getCorrelationId, requestLocalStorage } from './request-context.js';

describe('getCorrelationId & requestLocalStorage', () => {
  it('returns undefined outside an AsyncLocalStorage store context', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('provides isolated correlation IDs for concurrent async contexts without cross-bleed', async () => {
    const runTask = (id: string, delayMs: number) => {
      return requestLocalStorage.run({ correlationId: id }, async () => {
        expect(getCorrelationId()).toBe(id);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        expect(getCorrelationId()).toBe(id);

        return getCorrelationId();
      });
    };

    const [res1, res2, res3] = await Promise.all([
      runTask('req-alpha', 30),
      runTask('req-beta', 10),
      runTask('req-gamma', 20),
    ]);

    expect(res1).toBe('req-alpha');
    expect(res2).toBe('req-beta');
    expect(res3).toBe('req-gamma');
  });
});
