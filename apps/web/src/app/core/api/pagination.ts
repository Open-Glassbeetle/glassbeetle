/**
 * The paginated collection envelope every Glassbeetle list endpoint returns
 * (`docs/api-conventions.md` → "Pagination").
 */
export interface PaginatedResponse<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export type SortOrder = 'asc' | 'desc';

/** Pagination and sorting parameters accepted by every collection endpoint. */
export interface PageQuery {
  readonly limit?: number;
  readonly offset?: number;
  readonly sort?: string;
  readonly order?: SortOrder;
}

/** The API's own default page size, mirrored so the UI can preselect it. */
export const DEFAULT_PAGE_SIZE = 25;

/** Page sizes offered in the paginators; the API caps `limit` at 100. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** An empty envelope, used as the initial value of a list resource. */
export function emptyPage<T>(limit = DEFAULT_PAGE_SIZE): PaginatedResponse<T> {
  return { items: [], total: 0, limit, offset: 0 };
}
