import { FormControl } from '@angular/forms';

import {
  formatModelParams,
  modelParamsValidator,
  parseModelParams,
} from './model-params.validator';

function validate(value: string) {
  return modelParamsValidator(new FormControl(value));
}

describe('modelParamsValidator', () => {
  it('accepts an empty field, which clears the column', () => {
    expect(validate('')).toBeNull();
    expect(validate('   ')).toBeNull();
  });

  it('accepts a JSON object', () => {
    expect(validate('{ "top_p": 0.9 }')).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(validate('{ top_p: 0.9 }')).toEqual({ jsonSyntax: true });
  });

  it('rejects arrays and scalars, which the API rejects with IsObject', () => {
    expect(validate('[1, 2]')).toEqual({ jsonNotObject: true });
    expect(validate('"text"')).toEqual({ jsonNotObject: true });
    expect(validate('null')).toEqual({ jsonNotObject: true });
  });
});

describe('model params round trip', () => {
  it('formats stored params back into an editable field', () => {
    expect(formatModelParams({ top_p: 0.9 })).toBe('{\n  "top_p": 0.9\n}');
    expect(formatModelParams(null)).toBe('');
  });

  it('parses an empty field to null rather than to an empty object', () => {
    // `{}` would store an empty object; `null` clears the column.
    expect(parseModelParams('  ')).toBeNull();
    expect(parseModelParams('{"a":1}')).toEqual({ a: 1 });
  });
});
