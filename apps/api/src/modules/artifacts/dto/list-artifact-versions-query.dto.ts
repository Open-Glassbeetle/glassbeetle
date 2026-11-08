import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for collection endpoint `GET /api/v1/artifacts/:artifactId/versions`.
 *
 * Inherits standard pagination and sorting parameters:
 * - `limit`: Maximum items per page (default: 50, max: 100)
 * - `offset`: Zero-based pagination offset (default: 0)
 * - `sort`: Field to sort by ('version', 'createdAt', 'title', 'type', 'id')
 * - `order`: Sort direction ('asc' or 'desc', default: 'desc')
 */
export class ListArtifactVersionsQueryDto extends PaginationQueryDto {}
