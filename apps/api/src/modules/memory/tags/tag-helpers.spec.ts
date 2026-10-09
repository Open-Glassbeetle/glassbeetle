import { describe, expect, it } from 'vitest';
import {
  buildTagFilterPredicate,
  getDistinctTagsQuery,
  normalizeTag,
  normalizeTagsOnWrite,
  parseTagFilterInput,
  parseTagsOnRead,
} from './tag-helpers.js';

describe('tag-helpers', () => {
  describe('normalizeTag', () => {
    it('trims whitespace and folds case to lowercase', () => {
      expect(normalizeTag('  Project-X  ')).toBe('project-x');
      expect(normalizeTag('FEATURE')).toBe('feature');
    });

    it('returns null for empty or whitespace-only strings', () => {
      expect(normalizeTag('')).toBeNull();
      expect(normalizeTag('   ')).toBeNull();
    });

    it('truncates tags exceeding MAX_TAG_LENGTH (50 chars)', () => {
      const longTag = 'a'.repeat(60);
      const normalized = normalizeTag(longTag);
      expect(normalized).toHaveLength(50);
      expect(normalized).toBe('a'.repeat(50));
    });
  });

  describe('normalizeTagsOnWrite', () => {
    it('returns null for null, undefined, or empty array (canonical empty representation)', () => {
      expect(normalizeTagsOnWrite(null)).toBeNull();
      expect(normalizeTagsOnWrite(undefined)).toBeNull();
      expect(normalizeTagsOnWrite([])).toBeNull();
    });

    it('returns null when array contains only empty or whitespace strings', () => {
      expect(normalizeTagsOnWrite(['', '   '])).toBeNull();
    });

    it('trims, lowercases, deduplicates, and sorts tags canonically', () => {
      const input = ['  Beta  ', 'alpha', 'BETA', '  gamma  ', 'alpha'];
      const result = normalizeTagsOnWrite(input);

      expect(result).toBe('["alpha","beta","gamma"]');
    });

    it('serializes single tag as JSON array', () => {
      expect(normalizeTagsOnWrite(['Important'])).toBe('["important"]');
    });

    it('bounds the total number of tags to MAX_TAGS_PER_MEMORY (50)', () => {
      const tags = Array.from({ length: 60 }, (_, i) => `tag-${i}`);
      const result = normalizeTagsOnWrite(tags);
      const parsed = JSON.parse(result!);
      expect(parsed).toHaveLength(50);
    });
  });

  describe('parseTagsOnRead', () => {
    it('returns empty array for null, undefined, or empty string', () => {
      expect(parseTagsOnRead(null)).toEqual([]);
      expect(parseTagsOnRead(undefined)).toEqual([]);
      expect(parseTagsOnRead('')).toEqual([]);
      expect(parseTagsOnRead('   ')).toEqual([]);
    });

    it('parses valid JSON array of strings', () => {
      expect(parseTagsOnRead('["alpha","beta"]')).toEqual(['alpha', 'beta']);
    });

    it('returns empty array for empty JSON array string', () => {
      expect(parseTagsOnRead('[]')).toEqual([]);
    });

    it('gracefully degrades to empty array for malformed JSON without throwing', () => {
      expect(parseTagsOnRead('not-valid-json')).toEqual([]);
      expect(parseTagsOnRead('{ "invalid": true')).toEqual([]);
      expect(parseTagsOnRead('undefined')).toEqual([]);
    });

    it('gracefully degrades when JSON is not an array', () => {
      expect(parseTagsOnRead('123')).toEqual([]);
      expect(parseTagsOnRead('true')).toEqual([]);
      expect(parseTagsOnRead('{"key": "value"}')).toEqual([]);
      expect(parseTagsOnRead('"just-a-string"')).toEqual([]);
    });

    it('filters non-string items if present in parsed array', () => {
      expect(parseTagsOnRead('["valid", 123, null, true, "also-valid"]')).toEqual([
        'valid',
        'also-valid',
      ]);
    });

    it('handles already parsed arrays passed directly', () => {
      expect(parseTagsOnRead(['a', 'b'])).toEqual(['a', 'b']);
    });
  });

  describe('parseTagFilterInput', () => {
    it('parses and normalises comma-separated string input', () => {
      expect(parseTagFilterInput('Alpha, beta, ALPHA')).toEqual([
        'alpha',
        'beta',
      ]);
    });

    it('parses array input', () => {
      expect(parseTagFilterInput(['Tag1', 'tag2', 'tag1'])).toEqual([
        'tag1',
        'tag2',
      ]);
    });

    it('returns empty array for empty input', () => {
      expect(parseTagFilterInput('')).toEqual([]);
      expect(parseTagFilterInput([])).toEqual([]);
    });
  });

  describe('buildTagFilterPredicate', () => {
    it('returns null when input has no valid tags', () => {
      expect(buildTagFilterPredicate('')).toBeNull();
      expect(buildTagFilterPredicate('   ,  ')).toBeNull();
      expect(buildTagFilterPredicate([])).toBeNull();
    });

    it('builds SQL predicate for single tag with bound parameter', () => {
      const pred = buildTagFilterPredicate('Alpha');

      expect(pred).not.toBeNull();
      expect(pred?.sqlClause).toBe(
        '(tags IS NOT NULL AND json_valid(tags) = 1 AND EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?))',
      );
      expect(pred?.params).toEqual(['alpha']);
    });

    it('uses custom column name when specified', () => {
      const pred = buildTagFilterPredicate('test', {
        column: 'agent_memories.tags',
      });

      expect(pred?.sqlClause).toContain('agent_memories.tags IS NOT NULL');
      expect(pred?.sqlClause).toContain('json_valid(agent_memories.tags) = 1');
      expect(pred?.sqlClause).toContain(
        'FROM json_each(agent_memories.tags) WHERE json_each.value = ?',
      );
      expect(pred?.params).toEqual(['test']);
    });

    it('builds predicate for multiple tags with default "all" mode (intersection)', () => {
      const pred = buildTagFilterPredicate(['alpha', 'beta'], { mode: 'all' });

      expect(pred?.sqlClause).toBe(
        '(tags IS NOT NULL AND json_valid(tags) = 1 AND EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?) AND EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?))',
      );
      expect(pred?.params).toEqual(['alpha', 'beta']);
    });

    it('builds predicate for multiple tags with "any" mode (union)', () => {
      const pred = buildTagFilterPredicate('alpha, beta', { mode: 'any' });

      expect(pred?.sqlClause).toBe(
        '(tags IS NOT NULL AND json_valid(tags) = 1 AND EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value IN (?, ?)))',
      );
      expect(pred?.params).toEqual(['alpha', 'beta']);
    });
  });

  describe('getDistinctTagsQuery', () => {
    it('generates distinct query for shared_memories without agentId', () => {
      const query = getDistinctTagsQuery('shared_memories');

      expect(query.sql).toBe(
        'SELECT DISTINCT json_each.value AS tag FROM shared_memories, json_each(shared_memories.tags) WHERE shared_memories.tags IS NOT NULL AND json_valid(shared_memories.tags) = 1 ORDER BY tag ASC',
      );
      expect(query.params).toEqual([]);
    });

    it('generates distinct query for agent_memories scoped by agentId', () => {
      const query = getDistinctTagsQuery('agent_memories', {
        agentId: 'agent-123',
      });

      expect(query.sql).toBe(
        'SELECT DISTINCT json_each.value AS tag FROM agent_memories, json_each(agent_memories.tags) WHERE agent_memories.tags IS NOT NULL AND json_valid(agent_memories.tags) = 1 AND agent_memories.agent_id = ? ORDER BY tag ASC',
      );
      expect(query.params).toEqual(['agent-123']);
    });
  });
});
