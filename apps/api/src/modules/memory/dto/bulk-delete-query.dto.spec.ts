import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { BulkDeleteQueryDto } from './bulk-delete-query.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(BulkDeleteQueryDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('BulkDeleteQueryDto', () => {
  it('passes validation when confirm is exactly "true"', async () => {
    const errors = await validateDto({ confirm: 'true' });
    expect(errors).toHaveLength(0);
  });

  it('fails validation when confirm is omitted', async () => {
    const errors = await validateDto({});
    expect(errors.length).toBeGreaterThan(0);
    const confirmError = errors.find((e) => e.property === 'confirm');
    expect(confirmError).toBeDefined();
    expect(confirmError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('fails validation when confirm is empty string', async () => {
    const errors = await validateDto({ confirm: '' });
    expect(errors.length).toBeGreaterThan(0);
    const confirmError = errors.find((e) => e.property === 'confirm');
    expect(confirmError).toBeDefined();
    expect(confirmError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('fails validation when confirm is "false"', async () => {
    const errors = await validateDto({ confirm: 'false' });
    expect(errors.length).toBeGreaterThan(0);
    const confirmError = errors.find((e) => e.property === 'confirm');
    expect(confirmError).toBeDefined();
    expect(confirmError?.constraints?.equals).toBe(
      'confirm must be "true" to authorize irreversible deletion',
    );
  });

  it('fails validation when confirm is an unexpected string like "yes" or "1"', async () => {
    const errorsYes = await validateDto({ confirm: 'yes' });
    expect(errorsYes.length).toBeGreaterThan(0);

    const errorsOne = await validateDto({ confirm: '1' });
    expect(errorsOne.length).toBeGreaterThan(0);
  });

  it('fails validation when unexpected query parameters are provided', async () => {
    const errors = await validateDto({ confirm: 'true', unknownField: 'evil' });
    expect(errors.length).toBeGreaterThan(0);
    const unknownError = errors.find((e) => e.property === 'unknownField');
    expect(unknownError).toBeDefined();
  });
});
