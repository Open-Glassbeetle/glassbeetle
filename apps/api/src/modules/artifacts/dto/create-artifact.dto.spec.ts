import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ARTIFACT_TYPES,
  MAX_ARTIFACT_MIME_TYPE_LENGTH,
  MAX_ARTIFACT_TITLE_LENGTH,
} from './artifact-validators.js';
import { CreateArtifactDto } from './create-artifact.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(CreateArtifactDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('CreateArtifactDto', () => {
  it('accepts a valid inline text artifact', async () => {
    const errors = await validateDto({
      title: 'System Design Spec',
      type: 'document',
      content: '# Architecture Overview\nComponents and connections',
      mimeType: 'text/markdown',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid stored file artifact', async () => {
    const errors = await validateDto({
      title: 'Compiled Binary',
      type: 'file',
      filePath: 'artifacts/018f3a9e-0000-7000-8000-000000000001.bin',
      mimeType: 'application/octet-stream',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts valid foreign key references', async () => {
    const errors = await validateDto({
      title: 'Project Roadmap',
      type: 'document',
      content: 'Milestones and deliverables',
      projectId: '018f3a9e-0000-7000-8000-000000000002',
      chatId: '018f3a9e-0000-7000-8000-000000000003',
      agentId: '018f3a9e-0000-7000-8000-000000000004',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts all allowed artifact types', async () => {
    for (const type of ALLOWED_ARTIFACT_TYPES) {
      const errors = await validateDto({
        title: `Test ${type}`,
        type,
        content: 'content',
      });
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects an unrecognised type', async () => {
    const errors = await validateDto({
      title: 'Invalid Artifact',
      type: 'video_stream',
      content: 'stream',
    });
    expect(errors.length).toBeGreaterThan(0);
    const typeError = errors.find((e) => e.property === 'type');
    expect(typeError).toBeDefined();
    expect(typeError?.constraints).toHaveProperty('isIn');
  });

  it('rejects when both content and filePath are provided', async () => {
    const errors = await validateDto({
      title: 'Incoherent Artifact',
      type: 'code',
      content: 'const x = 1;',
      filePath: 'artifacts/file.ts',
    });
    expect(errors.length).toBeGreaterThan(0);
    const xorError = errors.find(
      (e) => e.property === '_contentXorFilePathRule',
    );
    expect(xorError).toBeDefined();
    expect(xorError?.constraints?.contentOrFilePathXor).toContain(
      'An artifact cannot define both content and filePath',
    );
  });

  it('rejects when neither content nor filePath is provided', async () => {
    const errors = await validateDto({
      title: 'Empty Artifact',
      type: 'document',
    });
    expect(errors.length).toBeGreaterThan(0);
    const xorError = errors.find(
      (e) => e.property === '_contentXorFilePathRule',
    );
    expect(xorError).toBeDefined();
    expect(xorError?.constraints?.contentOrFilePathXor).toContain(
      'An artifact must define exactly one of content (for inline text) or filePath',
    );
  });

  it('rejects missing title', async () => {
    const errors = await validateDto({
      type: 'document',
      content: 'Hello',
    });
    expect(errors.length).toBeGreaterThan(0);
    const titleError = errors.find((e) => e.property === 'title');
    expect(titleError).toBeDefined();
    expect(titleError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rejects empty title string', async () => {
    const errors = await validateDto({
      title: '',
      type: 'document',
      content: 'Hello',
    });
    expect(errors.length).toBeGreaterThan(0);
    const titleError = errors.find((e) => e.property === 'title');
    expect(titleError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rejects whitespace-only title', async () => {
    const errors = await validateDto({
      title: '    ',
      type: 'document',
      content: 'Hello',
    });
    expect(errors.length).toBeGreaterThan(0);
    const titleError = errors.find((e) => e.property === 'title');
    expect(titleError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rejects title exceeding maximum length', async () => {
    const errors = await validateDto({
      title: 'a'.repeat(MAX_ARTIFACT_TITLE_LENGTH + 1),
      type: 'document',
      content: 'Hello',
    });
    expect(errors.length).toBeGreaterThan(0);
    const titleError = errors.find((e) => e.property === 'title');
    expect(titleError?.constraints).toHaveProperty('maxLength');
  });

  it('rejects mimeType exceeding maximum length', async () => {
    const errors = await validateDto({
      title: 'Artifact',
      type: 'document',
      content: 'Hello',
      mimeType: 'a'.repeat(MAX_ARTIFACT_MIME_TYPE_LENGTH + 1),
    });
    expect(errors.length).toBeGreaterThan(0);
    const mimeError = errors.find((e) => e.property === 'mimeType');
    expect(mimeError?.constraints).toHaveProperty('maxLength');
  });

  it('rejects forbidden server-managed fields', async () => {
    for (const forbidden of [
      'id',
      'version',
      'hasFile',
      'createdAt',
      'updatedAt',
      'created_at',
      'updated_at',
    ]) {
      const errors = await validateDto({
        title: 'Artifact',
        type: 'document',
        content: 'Hello',
        [forbidden]: 'disallowed-value',
      });
      expect(errors.some((e) => e.property === forbidden)).toBe(true);
    }
  });
});

