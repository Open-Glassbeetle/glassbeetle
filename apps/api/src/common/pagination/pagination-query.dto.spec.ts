import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  parseBooleanQueryParam,
  TransformBoolean,
} from './boolean-query.decorator.js';
import { PaginationQueryDto } from './pagination-query.dto.js';

class TestFilterQueryDto extends PaginationQueryDto {
  @TransformBoolean()
  enabled?: boolean;
}

describe('PaginationQueryDto & Validation', () => {
  it('applies default limit of 50 and offset of 0', () => {
    const dto = plainToInstance(PaginationQueryDto, {});
    const errors = validateSync(dto);

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(50);
    expect(dto.offset).toBe(0);
  });

  it('accepts valid custom limit, offset, sort and order', () => {
    const dto = plainToInstance(PaginationQueryDto, {
      limit: '25',
      offset: '10',
      sort: 'createdAt',
      order: 'desc',
    });
    const errors = validateSync(dto);

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(25);
    expect(dto.offset).toBe(10);
    expect(dto.sort).toBe('createdAt');
    expect(dto.order).toBe('desc');
  });

  it('rejects limit above maximum (100)', () => {
    const dto = plainToInstance(PaginationQueryDto, { limit: '150' });
    const errors = validateSync(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('max');
  });

  it('rejects limit less than 1', () => {
    const dto = plainToInstance(PaginationQueryDto, { limit: '0' });
    const errors = validateSync(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('rejects negative offset', () => {
    const dto = plainToInstance(PaginationQueryDto, { offset: '-5' });
    const errors = validateSync(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('rejects invalid order string', () => {
    const dto = plainToInstance(PaginationQueryDto, {
      order: 'invalid-order',
    });
    const errors = validateSync(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isEnum');
  });

  describe('parseBooleanQueryParam & TransformBoolean', () => {
    it('parses boolean strings correctly', () => {
      expect(parseBooleanQueryParam('true')).toBe(true);
      expect(parseBooleanQueryParam('TRUE')).toBe(true);
      expect(parseBooleanQueryParam('1')).toBe(true);

      expect(parseBooleanQueryParam('false')).toBe(false);
      expect(parseBooleanQueryParam('0')).toBe(false);

      expect(parseBooleanQueryParam(undefined)).toBeUndefined();
      expect(parseBooleanQueryParam('unrecognized')).toBeUndefined();
    });

    it('transforms query DTO boolean properties', () => {
      const dto = plainToInstance(TestFilterQueryDto, { enabled: 'true' });
      expect(dto.enabled).toBe(true);

      const dto2 = plainToInstance(TestFilterQueryDto, { enabled: '0' });
      expect(dto2.enabled).toBe(false);
    });
  });
});
