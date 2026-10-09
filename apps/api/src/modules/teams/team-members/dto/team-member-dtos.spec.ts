import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  AddTeamMemberDto,
  MAX_MEMBER_ROLE_LENGTH,
} from './add-team-member.dto.js';
import { ReorderTeamMembersDto } from './reorder-team-members.dto.js';
import { mapTeamMemberRowToResponse } from './team-member.mapper.js';
import { UpdateTeamMemberDto } from './update-team-member.dto.js';

const VALIDATION_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

async function validateDto(cls: any, payload: Record<string, unknown>) {
  return validate(plainToInstance(cls, payload), VALIDATION_OPTIONS);
}

describe('AddTeamMemberDto', () => {
  it('accepts an agent id on its own', async () => {
    expect(await validateDto(AddTeamMemberDto, { agentId: 'a1' })).toHaveLength(
      0,
    );
  });

  it('requires an agent id', async () => {
    expect(await validateDto(AddTeamMemberDto, {})).toHaveLength(1);
    expect(await validateDto(AddTeamMemberDto, { agentId: '  ' })).toHaveLength(
      1,
    );
  });

  it('turns a role of only whitespace into no role at all', () => {
    expect(
      plainToInstance(AddTeamMemberDto, { agentId: 'a1', role: '   ' }).role,
    ).toBeNull();
  });

  it('bounds the role length', async () => {
    expect(
      await validateDto(AddTeamMemberDto, {
        agentId: 'a1',
        role: 'a'.repeat(MAX_MEMBER_ROLE_LENGTH + 1),
      }),
    ).toHaveLength(1);
  });

  it('rejects a position: order has exactly one way in', async () => {
    const errors = await validateDto(AddTeamMemberDto, {
      agentId: 'a1',
      position: 2,
    });

    expect(errors.map((error) => error.property)).toContain('position');
  });
});

describe('UpdateTeamMemberDto', () => {
  it('accepts an empty payload and an explicit null', async () => {
    expect(await validateDto(UpdateTeamMemberDto, {})).toHaveLength(0);
    expect(await validateDto(UpdateTeamMemberDto, { role: null })).toHaveLength(
      0,
    );
  });

  it('rejects a position here too', async () => {
    expect(
      await validateDto(UpdateTeamMemberDto, { position: 0 }),
    ).toHaveLength(1);
  });
});

describe('ReorderTeamMembersDto', () => {
  it('accepts a list of ids', async () => {
    expect(
      await validateDto(ReorderTeamMembersDto, { agentIds: ['a1', 'a2'] }),
    ).toHaveLength(0);
  });

  it('rejects an empty list and a missing one', async () => {
    expect(
      await validateDto(ReorderTeamMembersDto, { agentIds: [] }),
    ).toHaveLength(1);
    expect(await validateDto(ReorderTeamMembersDto, {})).toHaveLength(1);
  });

  it('rejects a list that is not all strings', async () => {
    expect(
      await validateDto(ReorderTeamMembersDto, { agentIds: ['a1', 7] }),
    ).toHaveLength(1);
  });
});

describe('mapTeamMemberRowToResponse', () => {
  const ROW = {
    team_id: 't1',
    agent_id: 'a1',
    role: 'Supervisor',
    position: 2,
    created_at: '2026-10-01T08:00:00.000Z',
  };

  it('maps the pair and the place', () => {
    expect(mapTeamMemberRowToResponse(ROW)).toEqual({
      teamId: 't1',
      agentId: 'a1',
      role: 'Supervisor',
      position: 2,
      createdAt: ROW.created_at,
    });
  });

  it('exposes no id, because the pair is the key', () => {
    expect(
      (mapTeamMemberRowToResponse(ROW) as Record<string, unknown>).id,
    ).toBeUndefined();
  });

  it('reports a row with no position at the front rather than as null', () => {
    expect(
      mapTeamMemberRowToResponse({ ...ROW, position: null }).position,
    ).toBe(0);
  });

  it('emits an unset role as null', () => {
    expect(mapTeamMemberRowToResponse({ ...ROW, role: null }).role).toBeNull();
  });
});
