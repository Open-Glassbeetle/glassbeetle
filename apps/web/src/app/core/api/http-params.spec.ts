import { toHttpParams } from './http-params';

describe('toHttpParams', () => {
  it('omits undefined, null and empty values', () => {
    // An empty filter must not be sent: the API reads `?search=` as a search
    // for the empty string rather than as no filter at all.
    const params = toHttpParams({
      limit: 25,
      offset: 0,
      search: '',
      tag: undefined,
      modelId: null,
    });

    expect(params.keys().sort()).toEqual(['limit', 'offset']);
  });

  it('keeps the literal "null" used to select unassigned rows', () => {
    const params = toHttpParams({ systemPromptId: 'null' });

    expect(params.get('systemPromptId')).toBe('null');
  });

  it('keeps a zero offset, which is a meaningful value', () => {
    expect(toHttpParams({ offset: 0 }).get('offset')).toBe('0');
  });
});
