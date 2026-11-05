import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  applyArtifactUpdates,
  mapArtifactRowToResponse,
  mapCreateArtifactDtoToRow,
  type ArtifactRow,
} from './artifact.mapper.js';
import type { CreateArtifactDto } from './create-artifact.dto.js';

describe('artifact.mapper', () => {
  const sampleRow: ArtifactRow = {
    id: '018f3a9e-0000-7000-8000-000000000001',
    project_id: '018f3a9e-0000-7000-8000-000000000002',
    chat_id: '018f3a9e-0000-7000-8000-000000000003',
    agent_id: '018f3a9e-0000-7000-8000-000000000004',
    title: 'Architecture Spec',
    type: 'document',
    mime_type: 'text/markdown',
    content: '# Architecture\nDetailed system layout',
    file_path: null,
    version: 1,
    created_at: '2026-09-21T09:30:52.123Z',
    updated_at: '2026-09-21T09:30:52.123Z',
  };

  describe('mapArtifactRowToResponse', () => {
    it('maps columns to camelCase and includes content on retrieve', () => {
      const response = mapArtifactRowToResponse(sampleRow, {
        includeContent: true,
      });

      expect(response).toEqual({
        id: sampleRow.id,
        projectId: sampleRow.project_id,
        chatId: sampleRow.chat_id,
        agentId: sampleRow.agent_id,
        title: sampleRow.title,
        type: sampleRow.type,
        mimeType: sampleRow.mime_type,
        content: sampleRow.content,
        hasFile: false,
        version: 1,
        createdAt: sampleRow.created_at,
        updatedAt: sampleRow.updated_at,
      });
      expect(response).not.toHaveProperty('file_path');
    });

    it('omits content when includeContent is false', () => {
      const response = mapArtifactRowToResponse(sampleRow, {
        includeContent: false,
      });

      expect(response).not.toHaveProperty('content');
      expect(response.hasFile).toBe(false);
      expect(response.title).toBe(sampleRow.title);
    });

    it('sets hasFile: true and hides file_path when backing file is present', () => {
      const fileRow: ArtifactRow = {
        ...sampleRow,
        content: null,
        file_path: 'artifacts/binary.bin',
      };
      const response = mapArtifactRowToResponse(fileRow, {
        includeContent: true,
      });

      expect(response.hasFile).toBe(true);
      expect(response.content).toBeNull();
      expect(response).not.toHaveProperty('file_path');
      expect(response).not.toHaveProperty('filePath');
    });
  });

  describe('mapCreateArtifactDtoToRow', () => {
    it('generates a row with default version 1 and server timestamps', () => {
      const dto: CreateArtifactDto = {
        title: 'New Artifact',
        type: 'code',
        content: 'console.log("hello");',
        mimeType: 'text/javascript',
      };

      const row = mapCreateArtifactDtoToRow(dto, {
        id: 'pinned-id',
        now: '2026-09-21T10:00:00.000Z',
      });

      expect(row).toEqual({
        id: 'pinned-id',
        project_id: null,
        chat_id: null,
        agent_id: null,
        title: 'New Artifact',
        type: 'code',
        mime_type: 'text/javascript',
        content: 'console.log("hello");',
        file_path: null,
        version: 1,
        created_at: '2026-09-21T10:00:00.000Z',
        updated_at: '2026-09-21T10:00:00.000Z',
      });
    });
  });

  describe('applyArtifactUpdates', () => {
    it('applies partial updates, increments version and advances updated_at', () => {
      const result = applyArtifactUpdates(
        sampleRow,
        { title: 'Updated Spec' },
        { now: '2026-09-21T11:00:00.000Z' },
      );

      expect(result.hasChanges).toBe(true);
      expect(result.updatedRow.title).toBe('Updated Spec');
      expect(result.updatedRow.version).toBe(2);
      expect(result.updatedRow.updated_at).toBe('2026-09-21T11:00:00.000Z');
      expect(result.updatedRow.created_at).toBe(sampleRow.created_at);
      expect(result.setClauses).toContain('title = ?');
      expect(result.setClauses).toContain('version = ?');
      expect(result.setClauses).toContain('updated_at = ?');
    });

    it('returns hasChanges: false and leaves version untouched on empty update', () => {
      const result = applyArtifactUpdates(sampleRow, {});

      expect(result.hasChanges).toBe(false);
      expect(result.updatedRow.version).toBe(sampleRow.version);
      expect(result.updatedRow.updated_at).toBe(sampleRow.updated_at);
      expect(result.setClauses).toHaveLength(0);
    });

    it('allows clearing content while setting filePath', () => {
      const result = applyArtifactUpdates(sampleRow, {
        content: null,
        filePath: 'artifacts/new.bin',
      });

      expect(result.hasChanges).toBe(true);
      expect(result.updatedRow.content).toBeNull();
      expect(result.updatedRow.file_path).toBe('artifacts/new.bin');
      expect(result.updatedRow.version).toBe(2);
    });

    it('rejects update that attempts to clear both content and filePath', () => {
      expect(() =>
        applyArtifactUpdates(sampleRow, {
          content: null,
          filePath: null,
        }),
      ).toThrow(BadRequestException);
    });

    it('rejects update that attempts to set both content and filePath', () => {
      expect(() =>
        applyArtifactUpdates(sampleRow, {
          content: 'text',
          filePath: 'path/file.bin',
        }),
      ).toThrow(BadRequestException);
    });

    it('identifies unlinkedFilePath when replacing a file artifact with content', () => {
      const fileRow: ArtifactRow = {
        ...sampleRow,
        content: null,
        file_path: 'artifacts/old-file.bin',
      };

      const result = applyArtifactUpdates(fileRow, {
        content: 'inline replacement',
        filePath: null,
      });

      expect(result.unlinkedFilePath).toBe('artifacts/old-file.bin');
      expect(result.updatedRow.content).toBe('inline replacement');
      expect(result.updatedRow.file_path).toBeNull();
    });
  });
});

