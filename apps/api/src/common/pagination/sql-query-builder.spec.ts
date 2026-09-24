import { BadRequestException } from '@nestjs/common';
import type { PaginationQueryDto } from './pagination-query.dto.js';
import { buildPaginationSqlFragment } from './sql-query-builder.js';

describe('buildPaginationSqlFragment', () => {
  const allowedSortColumns = {
    createdAt: 'created_at',
    name: 'name',
    id: 'id',
  };

  it('builds SQL clause for default sort and pagination', () => {
    const query: PaginationQueryDto = { limit: 50, offset: 0 };

    const result = buildPaginationSqlFragment({
      query,
      allowedSortColumns,
      defaultSortKey: 'createdAt',
    });

    expect(result.orderBySql).toBe('ORDER BY created_at DESC, id DESC');
    expect(result.limitOffsetSql).toBe('LIMIT ? OFFSET ?');
    expect(result.clauseSql).toBe(
      'ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    );
    expect(result.params).toEqual([50, 0]);
  });

  it('builds SQL clause for explicit sort and order', () => {
    const query: PaginationQueryDto = {
      limit: 20,
      offset: 40,
      sort: 'name',
      order: 'asc',
    };

    const result = buildPaginationSqlFragment({
      query,
      allowedSortColumns,
      defaultSortKey: 'createdAt',
    });

    expect(result.orderBySql).toBe('ORDER BY name ASC, id ASC');
    expect(result.params).toEqual([20, 40]);
  });

  it('rejects an unknown sort field with a 400 BadRequestException', () => {
    const query: PaginationQueryDto = {
      limit: 50,
      offset: 0,
      sort: 'unauthorized_column',
    };

    expect(() => {
      buildPaginationSqlFragment({
        query,
        allowedSortColumns,
        defaultSortKey: 'createdAt',
      });
    }).toThrow(BadRequestException);

    try {
      buildPaginationSqlFragment({
        query,
        allowedSortColumns,
        defaultSortKey: 'createdAt',
      });
    } catch (err: any) {
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('Invalid sort field "unauthorized_column"');
      expect(err.message).toContain('createdAt, name, id');
    }
  });

  it('prevents SQL injection attempts in sort parameter', () => {
    const sqlInjectionAttempts = [
      'createdAt; DROP TABLE agents;--',
      '1 OR 1=1',
      'name UNION SELECT * FROM users',
      'id; DELETE FROM agents',
    ];

    for (const attempt of sqlInjectionAttempts) {
      const query: PaginationQueryDto = {
        limit: 10,
        offset: 0,
        sort: attempt,
      };

      expect(() => {
        buildPaginationSqlFragment({
          query,
          allowedSortColumns,
          defaultSortKey: 'createdAt',
        });
      }).toThrow(BadRequestException);
    }
  });
});
