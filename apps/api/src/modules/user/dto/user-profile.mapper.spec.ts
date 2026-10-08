import { describe, expect, it } from 'vitest';
import {
  applyUserProfileUpdates,
  mapUserProfileRowToResponse,
  type UserProfileRow,
} from './user-profile.mapper.js';

const ROW: UserProfileRow = {
  id: '018f3a9e-0000-7000-8000-000000000001',
  singleton: 1,
  display_name: 'Ada',
  pronouns: 'she/her',
  about: 'Works on Glassbeetle.',
  locale: 'de-CH',
  timezone: 'Europe/Zurich',
  include_in_prompts: 1,
  picture_path: 'pictures/018f3a9e-0000-7000-8000-000000000099.png',
  picture_updated_at: '2026-10-08T14:22:10.904Z',
  created_at: '2026-10-01T08:00:00.000Z',
  updated_at: '2026-10-08T14:22:10.904Z',
};

describe('mapUserProfileRowToResponse', () => {
  it('maps every column to its camelCase field', () => {
    expect(mapUserProfileRowToResponse(ROW)).toEqual({
      id: ROW.id,
      displayName: 'Ada',
      pronouns: 'she/her',
      about: 'Works on Glassbeetle.',
      locale: 'de-CH',
      timezone: 'Europe/Zurich',
      includeInPrompts: true,
      hasPicture: true,
      pictureUpdatedAt: '2026-10-08T14:22:10.904Z',
      createdAt: ROW.created_at,
      updatedAt: ROW.updated_at,
    });
  });

  it('never leaks the stored picture path', () => {
    const response = mapUserProfileRowToResponse(ROW) as Record<
      string,
      unknown
    >;

    expect(response.picture_path).toBeUndefined();
    expect(response.picturePath).toBeUndefined();
    expect(Object.values(response)).not.toContain(ROW.picture_path);
  });

  it('never leaks the singleton constraint column', () => {
    const response = mapUserProfileRowToResponse(ROW) as Record<
      string,
      unknown
    >;

    expect(response.singleton).toBeUndefined();
  });

  it('emits unset columns as null rather than omitting them', () => {
    const response = mapUserProfileRowToResponse({
      ...ROW,
      display_name: null,
      pronouns: null,
      about: null,
      locale: null,
      timezone: null,
      picture_path: null,
      picture_updated_at: null,
    });

    expect(response).toMatchObject({
      displayName: null,
      pronouns: null,
      about: null,
      locale: null,
      timezone: null,
      pictureUpdatedAt: null,
      hasPicture: false,
    });
    expect('displayName' in response).toBe(true);
  });

  it('turns the stored 0/1 flag into a real boolean', () => {
    expect(
      mapUserProfileRowToResponse({ ...ROW, include_in_prompts: 0 })
        .includeInPrompts,
    ).toBe(false);
  });
});

describe('applyUserProfileUpdates', () => {
  const NOW = '2026-11-01T10:00:00.000Z';

  it('reports no changes for an empty payload and leaves updated_at alone', () => {
    const result = applyUserProfileUpdates(ROW, {}, { now: NOW });

    expect(result.hasChanges).toBe(false);
    expect(result.setClauses).toEqual([]);
    expect(result.updatedRow.updated_at).toBe(ROW.updated_at);
  });

  it('reports no changes when a field is set to the value it already holds', () => {
    const result = applyUserProfileUpdates(
      ROW,
      { displayName: 'Ada', includeInPrompts: true },
      { now: NOW },
    );

    expect(result.hasChanges).toBe(false);
    expect(result.updatedRow.updated_at).toBe(ROW.updated_at);
  });

  it('updates a changed field and bumps updated_at', () => {
    const result = applyUserProfileUpdates(
      ROW,
      { displayName: 'Grace' },
      { now: NOW },
    );

    expect(result.hasChanges).toBe(true);
    expect(result.setClauses).toEqual(['display_name = ?', 'updated_at = ?']);
    expect(result.setParams).toEqual(['Grace', NOW]);
    expect(result.updatedRow.display_name).toBe('Grace');
    expect(result.updatedRow.updated_at).toBe(NOW);
  });

  it('clears a field on explicit null', () => {
    const result = applyUserProfileUpdates(ROW, { about: null }, { now: NOW });

    expect(result.setClauses).toEqual(['about = ?', 'updated_at = ?']);
    expect(result.setParams).toEqual([null, NOW]);
    expect(result.updatedRow.about).toBeNull();
  });

  it('leaves an omitted field untouched', () => {
    const result = applyUserProfileUpdates(
      ROW,
      { pronouns: 'they/them' },
      { now: NOW },
    );

    expect(result.setClauses).not.toContain('about = ?');
    expect(result.updatedRow.about).toBe(ROW.about);
  });

  it('stores includeInPrompts as SQLite 0/1', () => {
    const result = applyUserProfileUpdates(
      ROW,
      { includeInPrompts: false },
      { now: NOW },
    );

    expect(result.setParams).toEqual([0, NOW]);
    expect(result.updatedRow.include_in_prompts).toBe(0);
  });

  it('collects several changes into one statement', () => {
    const result = applyUserProfileUpdates(
      ROW,
      { displayName: 'Grace', locale: 'en-GB', includeInPrompts: false },
      { now: NOW },
    );

    expect(result.setClauses).toEqual([
      'display_name = ?',
      'locale = ?',
      'include_in_prompts = ?',
      'updated_at = ?',
    ]);
    expect(result.setParams).toEqual(['Grace', 'en-GB', 0, NOW]);
  });

  it('never writes the picture columns, which only the picture endpoints own', () => {
    const result = applyUserProfileUpdates(
      ROW,
      { displayName: 'Grace' },
      { now: NOW },
    );

    expect(result.setClauses.join(' ')).not.toContain('picture');
  });
});
