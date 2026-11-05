import { describe, expect, it } from 'vitest';
import {
  applyProjectUpdates,
  mapCreateProjectDtoToRow,
  mapProjectRowToResponse,
  type ProjectRow,
  type ProjectRowWithCounts,
} from './project.mapper.js';

describe('project.mapper', () => {
  describe('mapProjectRowToResponse', () => {
    it('maps database row with counts correctly to ProjectResponseDto', () => {
      const row: ProjectRowWithCounts = {
        id: '018f3a9e-0000-7000-8000-000000000001',
        name: 'Compiler Project',
        description: 'Optimizing compiler infrastructure',
        image_path: 'pictures/018f3a9e-0000-7000-8000-000000000002.jpg',
        created_at: '2026-09-21T09:30:52.000Z',
        updated_at: '2026-09-21T09:30:52.000Z',
        chat_count: 5,
        artifact_count: 12,
      };

      const response = mapProjectRowToResponse(row);

      expect(response).toEqual({
        id: '018f3a9e-0000-7000-8000-000000000001',
        name: 'Compiler Project',
        description: 'Optimizing compiler infrastructure',
        hasImage: true,
        chatCount: 5,
        artifactCount: 12,
        createdAt: '2026-09-21T09:30:52.000Z',
        updatedAt: '2026-09-21T09:30:52.000Z',
      });
      expect((response as any).image_path).toBeUndefined();
      expect((response as any).imagePath).toBeUndefined();
    });

    it('sets hasImage: false and description: null when null in row', () => {
      const row: ProjectRowWithCounts = {
        id: '018f3a9e-0000-7000-8000-000000000001',
        name: 'Blank Project',
        description: null,
        image_path: null,
        created_at: '2026-09-21T09:30:52.000Z',
        updated_at: '2026-09-21T09:30:52.000Z',
      };

      const response = mapProjectRowToResponse(row);

      expect(response.hasImage).toBe(false);
      expect(response.description).toBeNull();
      expect(response.chatCount).toBe(0);
      expect(response.artifactCount).toBe(0);
    });
  });

  describe('mapCreateProjectDtoToRow', () => {
    it('maps create DTO to row with generated ID and timestamps', () => {
      const row = mapCreateProjectDtoToRow({
        name: 'My Project',
        description: 'Description',
      });

      expect(row.id).toBeDefined();
      expect(row.name).toBe('My Project');
      expect(row.description).toBe('Description');
      expect(row.image_path).toBeNull();
      expect(row.created_at).toBeDefined();
      expect(row.updated_at).toBe(row.created_at);
    });

    it('respects options for pinned ID and timestamp', () => {
      const row = mapCreateProjectDtoToRow(
        { name: 'Pinned Project' },
        { id: 'custom-id', now: '2026-10-01T00:00:00.000Z' },
      );

      expect(row.id).toBe('custom-id');
      expect(row.name).toBe('Pinned Project');
      expect(row.description).toBeNull();
      expect(row.created_at).toBe('2026-10-01T00:00:00.000Z');
      expect(row.updated_at).toBe('2026-10-01T00:00:00.000Z');
    });
  });

  describe('applyProjectUpdates', () => {
    const existing: ProjectRow = {
      id: '018f3a9e-0000-7000-8000-000000000001',
      name: 'Old Name',
      description: 'Old Description',
      image_path: 'pictures/existing.jpg',
      created_at: '2026-09-20T00:00:00.000Z',
      updated_at: '2026-09-20T00:00:00.000Z',
    };

    it('updating name does not clear description', () => {
      const result = applyProjectUpdates(existing, { name: 'New Name' });

      expect(result.hasChanges).toBe(true);
      expect(result.updatedRow.name).toBe('New Name');
      expect(result.updatedRow.description).toBe('Old Description');
      expect(result.updatedRow.created_at).toBe(existing.created_at);
      expect(result.setClauses).toEqual(['name = ?', 'updated_at = ?']);
      expect(result.setParams[0]).toBe('New Name');
    });

    it('setting description to null clears it', () => {
      const result = applyProjectUpdates(existing, { description: null });

      expect(result.hasChanges).toBe(true);
      expect(result.updatedRow.description).toBeNull();
      expect(result.updatedRow.name).toBe('Old Name');
      expect(result.setClauses).toEqual(['description = ?', 'updated_at = ?']);
      expect(result.setParams[0]).toBeNull();
    });

    it('empty update payload produces no changes and does not bump updated_at', () => {
      const result = applyProjectUpdates(existing, {});

      expect(result.hasChanges).toBe(false);
      expect(result.updatedRow.updated_at).toBe(existing.updated_at);
      expect(result.setClauses).toHaveLength(0);
      expect(result.setParams).toHaveLength(0);
    });

    it('identical values produce no changes', () => {
      const result = applyProjectUpdates(existing, {
        name: 'Old Name',
        description: 'Old Description',
      });

      expect(result.hasChanges).toBe(false);
      expect(result.setClauses).toHaveLength(0);
    });
  });
});

