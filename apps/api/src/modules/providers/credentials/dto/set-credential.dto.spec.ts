import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CREDENTIAL_MAX_LENGTH,
  SetCredentialDto,
} from './set-credential.dto.js';

describe('SetCredentialDto length bounds', () => {
  it('accepts a credential at the maximum length', () => {
    const dto = plainToInstance(SetCredentialDto, {
      apiKey: 'k'.repeat(CREDENTIAL_MAX_LENGTH),
    });
    const errors = validateSync(dto);

    expect(errors).toHaveLength(0);
    expect(dto.apiKey).toHaveLength(CREDENTIAL_MAX_LENGTH);
  });

  it('rejects an apiKey longer than the maximum', () => {
    const dto = plainToInstance(SetCredentialDto, {
      apiKey: 'k'.repeat(CREDENTIAL_MAX_LENGTH + 1),
    });
    const errors = validateSync(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('apiKey');
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('bounds the alternative "value" property the same way', () => {
    const valid = plainToInstance(SetCredentialDto, {
      value: 'k'.repeat(CREDENTIAL_MAX_LENGTH),
    });
    expect(validateSync(valid)).toHaveLength(0);

    const overlong = plainToInstance(SetCredentialDto, {
      value: 'k'.repeat(CREDENTIAL_MAX_LENGTH + 1),
    });
    const errors = validateSync(overlong);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('value');
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('still rejects an empty credential', () => {
    const dto = plainToInstance(SetCredentialDto, { apiKey: '   ' });
    const errors = validateSync(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('minLength');
  });
});
