import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  MAX_ABOUT_LENGTH,
  UpdateUserProfileDto,
} from './update-user-profile.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

function instantiate(payload: Record<string, unknown>): UpdateUserProfileDto {
  return plainToInstance(UpdateUserProfileDto, payload);
}

async function validateDto(payload: Record<string, unknown>) {
  return validate(instantiate(payload), VALIDATION_OPTIONS);
}

describe('UpdateUserProfileDto', () => {
  it('accepts an empty payload, which the service treats as a no-op', async () => {
    expect(await validateDto({})).toHaveLength(0);
  });

  it('accepts a complete payload', async () => {
    const errors = await validateDto({
      displayName: 'Ada',
      pronouns: 'she/her',
      about: 'Works on Glassbeetle. Prefers short answers.',
      locale: 'de-CH',
      timezone: 'Europe/Zurich',
      includeInPrompts: false,
    });

    expect(errors).toHaveLength(0);
  });

  it('accepts null for every nullable field', async () => {
    const errors = await validateDto({
      displayName: null,
      pronouns: null,
      about: null,
      locale: null,
      timezone: null,
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects unknown properties', async () => {
    const errors = await validateDto({ email: 'ada@example.com' });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('email');
  });

  it('rejects server-managed and derived fields', async () => {
    for (const property of [
      'id',
      'createdAt',
      'updatedAt',
      'hasPicture',
      'pictureUpdatedAt',
      'picturePath',
    ]) {
      const errors = await validateDto({ [property]: 'anything' });
      expect(errors.map((error) => error.property)).toContain(property);
    }
  });

  describe('trimming', () => {
    it('trims surrounding whitespace', () => {
      const dto = instantiate({ displayName: '  Ada  ' });
      expect(dto.displayName).toBe('Ada');
    });

    it('turns a field emptied by a form into null rather than an empty string', () => {
      const dto = instantiate({ displayName: '   ', about: '' });

      expect(dto.displayName).toBeNull();
      expect(dto.about).toBeNull();
    });

    it('leaves a non-string alone so the type check still reports it', async () => {
      const errors = await validateDto({ displayName: 42 });

      expect(errors).toHaveLength(1);
      expect(Object.values(errors[0].constraints ?? {})).toContain(
        'displayName must be a string',
      );
    });
  });

  describe('length bounds', () => {
    it('rejects a displayName over 120 characters', async () => {
      const errors = await validateDto({ displayName: 'a'.repeat(121) });

      expect(Object.values(errors[0].constraints ?? {})).toContain(
        'displayName must not exceed 120 characters',
      );
    });

    it('rejects pronouns over 60 characters', async () => {
      const errors = await validateDto({ pronouns: 'a'.repeat(61) });

      expect(errors).toHaveLength(1);
    });

    it('accepts about at exactly the prompt budget and rejects one over', async () => {
      expect(
        await validateDto({ about: 'a'.repeat(MAX_ABOUT_LENGTH) }),
      ).toHaveLength(0);
      expect(
        await validateDto({ about: 'a'.repeat(MAX_ABOUT_LENGTH + 1) }),
      ).toHaveLength(1);
    });
  });

  describe('locale', () => {
    it.each(['de', 'de-CH', 'en-US', 'pt-BR'])('accepts %s', async (locale) => {
      expect(await validateDto({ locale })).toHaveLength(0);
    });

    it.each(['definitely not a locale', 'de_CH!', '123'])(
      'rejects %s',
      async (locale) => {
        expect(await validateDto({ locale })).toHaveLength(1);
      },
    );
  });

  describe('timezone', () => {
    it.each(['Europe/Zurich', 'America/New_York', 'UTC'])(
      'accepts %s',
      async (timezone) => {
        expect(await validateDto({ timezone })).toHaveLength(0);
      },
    );

    it('rejects a zone ICU cannot resolve', async () => {
      const errors = await validateDto({ timezone: 'Mars/Olympus_Mons' });

      expect(errors).toHaveLength(1);
      expect(Object.values(errors[0].constraints ?? {})[0]).toContain(
        'IANA time zone',
      );
    });

    it('rejects a UTC offset, which is not a zone and does not track DST', async () => {
      expect(await validateDto({ timezone: '+02:00' })).toHaveLength(1);
    });
  });

  describe('includeInPrompts', () => {
    it('accepts booleans', async () => {
      expect(await validateDto({ includeInPrompts: true })).toHaveLength(0);
      expect(await validateDto({ includeInPrompts: false })).toHaveLength(0);
    });

    it('rejects a string, since implicit conversion is off', async () => {
      expect(await validateDto({ includeInPrompts: 'true' })).toHaveLength(1);
    });

    it('rejects null: the flag is NOT NULL and has no "unset" state', async () => {
      expect(await validateDto({ includeInPrompts: null })).toHaveLength(1);
    });
  });
});
