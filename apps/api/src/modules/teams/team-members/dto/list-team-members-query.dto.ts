import { PaginationQueryDto } from '../../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for `GET /api/v1/teams/:teamId/members`.
 *
 * Carries pagination only. The sort whitelist holds one key, `position`,
 * because that is the roster's turn order and the only ordering of it that
 * means anything — sorting agents by name would present a sequence the team
 * will never run in. Anything else is rejected by the shared whitelist with
 * the allowed key named.
 */
export class ListTeamMembersQueryDto extends PaginationQueryDto {}
