import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  CreateTeamDto,
  MAX_TEAM_DESCRIPTION_LENGTH,
  MAX_TEAM_NAME_LENGTH,
} from './create-team.dto.js';
import { UpdateTeamDto } from './update-team.dto.js';

const VALIDATION_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

async function validateCreate(payload: Record<string, unknown>) {
  return validate(plainToInstance(CreateTeamDto, payload), VALIDATION_OPTIONS);
}

async function validateUpdate(payload: Record<string, unknown>) {
  return validate(plainToInstance(UpdateTeamDto, payload), VALIDATION_OPTIONS);
}

describe('CreateTeamDto', () => {
  it('accepts a name on its own', async () => {
    expect(await validateCreate({ name: 'Research Desk' })).toHaveLength(0);
  });

  it('accepts a name and a description', async () => {
    expect(
      await validateCreate({
        name: 'Research Desk',
        description: 'Finds things',
      }),
    ).toHaveLength(0);
  });

  it('requires a name', async () => {
    expect(await validateCreate({})).toHaveLength(1);
  });

  it('rejects a name of only whitespace, which would be invisible in a list', async () => {
    const errors = await validateCreate({ name: '   ' });

    expect(Object.values(errors[0].constraints ?? {})).toContain(
      'name must not be empty',
    );
  });

  it('trims the name it stores', () => {
    expect(
      plainToInstance(CreateTeamDto, { name: '  Research Desk  ' }).name,
    ).toBe('Research Desk');
  });

  it('enforces the length bounds', async () => {
    expect(
      await validateCreate({ name: 'a'.repeat(MAX_TEAM_NAME_LENGTH) }),
    ).toHaveLength(0);
    expect(
      await validateCreate({ name: 'a'.repeat(MAX_TEAM_NAME_LENGTH + 1) }),
    ).toHaveLength(1);
    expect(
      await validateCreate({
        name: 'x',
        description: 'a'.repeat(MAX_TEAM_DESCRIPTION_LENGTH + 1),
      }),
    ).toHaveLength(1);
  });

  it('rejects unknown and server-managed fields', async () => {
    for (const property of [
      'id',
      'createdAt',
      'updatedAt',
      'memberCount',
      'members',
    ]) {
      const errors = await validateCreate({
        name: 'x',
        [property]: 'anything',
      });
      expect(errors.map((error) => error.property)).toContain(property);
    }
  });
});

describe('UpdateTeamDto', () => {
  it('accepts an empty payload, which the service treats as a no-op', async () => {
    expect(await validateUpdate({})).toHaveLength(0);
  });

  it('accepts null for the description, which clears it', async () => {
    expect(await validateUpdate({ description: null })).toHaveLength(0);
  });

  it('refuses to clear the name: a team has to be nameable in a list', async () => {
    expect(await validateUpdate({ name: null })).toHaveLength(1);
    expect(await validateUpdate({ name: '' })).toHaveLength(1);
    expect(await validateUpdate({ name: '   ' })).toHaveLength(1);
  });
});
