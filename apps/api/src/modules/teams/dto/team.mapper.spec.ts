import { describe, expect, it } from 'vitest';
import {
  applyTeamUpdates,
  mapCreateTeamDtoToRow,
  mapTeamRowToResponse,
  type TeamRow,
  type TeamRowWithCount,
} from './team.mapper.js';

const ROW: TeamRowWithCount = {
  id: '018f3a9e-0000-7000-8000-000000000001',
  name: 'Research Desk',
  description: 'Finds things',
  member_count: 3,
  created_at: '2026-10-01T08:00:00.000Z',
  updated_at: '2026-10-01T08:00:00.000Z',
};

describe('mapTeamRowToResponse', () => {
  it('maps every column to its camelCase field', () => {
    expect(mapTeamRowToResponse(ROW)).toEqual({
      id: ROW.id,
      name: 'Research Desk',
      description: 'Finds things',
      memberCount: 3,
      createdAt: ROW.created_at,
      updatedAt: ROW.updated_at,
    });
  });

  it('emits an unset description as null rather than omitting it', () => {
    const response = mapTeamRowToResponse({ ...ROW, description: null });

    expect(response.description).toBeNull();
    expect('description' in response).toBe(true);
  });

  it('reports a missing count as zero, not as blank', () => {
    const response = mapTeamRowToResponse({
      ...ROW,
      member_count: undefined as unknown as number,
    });

    expect(response.memberCount).toBe(0);
  });

  it('coerces a count SQLite handed back as text', () => {
    const response = mapTeamRowToResponse({
      ...ROW,
      member_count: '2' as unknown as number,
    });

    expect(response.memberCount).toBe(2);
  });
});

describe('mapCreateTeamDtoToRow', () => {
  it('generates an id and stamps both timestamps the same', () => {
    const row = mapCreateTeamDtoToRow({ name: 'Research Desk' });

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.created_at).toBe(row.updated_at);
    expect(row.description).toBeNull();
  });

  it('honours an explicit id and timestamp, which the tests rely on', () => {
    const row = mapCreateTeamDtoToRow(
      { name: 'Research Desk' },
      { id: 'fixed', now: '2026-01-01T00:00:00.000Z' },
    );

    expect(row).toMatchObject({
      id: 'fixed',
      created_at: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('applyTeamUpdates', () => {
  const NOW = '2026-11-01T10:00:00.000Z';
  const BASE: TeamRow = {
    id: ROW.id,
    name: ROW.name,
    description: ROW.description,
    created_at: ROW.created_at,
    updated_at: ROW.updated_at,
  };

  it('reports no changes for an empty payload', () => {
    const result = applyTeamUpdates(BASE, {}, { now: NOW });

    expect(result.hasChanges).toBe(false);
    expect(result.updatedRow.updated_at).toBe(BASE.updated_at);
  });

  it('reports no change when a field is set to what it already holds', () => {
    expect(
      applyTeamUpdates(BASE, { name: 'Research Desk' }, { now: NOW })
        .hasChanges,
    ).toBe(false);
  });

  it('changes a field and bumps updated_at', () => {
    const result = applyTeamUpdates(
      BASE,
      { name: 'Release Crew' },
      { now: NOW },
    );

    expect(result.setClauses).toEqual(['name = ?', 'updated_at = ?']);
    expect(result.setParams).toEqual(['Release Crew', NOW]);
    expect(result.updatedRow.updated_at).toBe(NOW);
  });

  it('clears the description on an explicit null', () => {
    const result = applyTeamUpdates(BASE, { description: null }, { now: NOW });

    expect(result.setParams).toEqual([null, NOW]);
  });

  it('leaves an omitted field untouched', () => {
    const result = applyTeamUpdates(
      BASE,
      { name: 'Release Crew' },
      { now: NOW },
    );

    expect(result.updatedRow.description).toBe(BASE.description);
  });

  it('collects both fields into one statement', () => {
    const result = applyTeamUpdates(
      BASE,
      { name: 'Release Crew', description: 'Ships it' },
      { now: NOW },
    );

    expect(result.setClauses).toEqual([
      'name = ?',
      'description = ?',
      'updated_at = ?',
    ]);
  });
});
