import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-base';
import { toHttpParams } from './http-params';
import type { PaginatedResponse } from './pagination';
import type {
  AddTeamMemberInput,
  CreateTeamInput,
  Team,
  TeamListQuery,
  TeamMember,
  UpdateTeamInput,
  UpdateTeamMemberInput,
} from './teams.models';

/** `/api/v1/teams` — teams and their rosters. */
@Injectable({ providedIn: 'root' })
export class TeamsService extends ApiClient {
  list(query: TeamListQuery = {}): Observable<PaginatedResponse<Team>> {
    return this.http.get<PaginatedResponse<Team>>(this.url('/teams'), {
      params: toHttpParams({ ...query }),
    });
  }

  get(teamId: string): Observable<Team> {
    return this.http.get<Team>(this.url(`/teams/${teamId}`));
  }

  create(input: CreateTeamInput): Observable<Team> {
    return this.http.post<Team>(this.url('/teams'), input);
  }

  /**
   * Partial update. Keys absent from `input` are left untouched; an explicit
   * `null` clears the description.
   */
  update(teamId: string, input: UpdateTeamInput): Observable<Team> {
    return this.http.patch<Team>(this.url(`/teams/${teamId}`), input);
  }

  /** Deletes the team. The roster goes with it; the agents do not. */
  remove(teamId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/teams/${teamId}`));
  }

  /**
   * The roster, in turn order.
   *
   * Asked for in one page: a team is a handful of agents, and the order only
   * means anything whole — reordering requires the full set.
   */
  members(teamId: string): Observable<PaginatedResponse<TeamMember>> {
    return this.http.get<PaginatedResponse<TeamMember>>(this.url(`/teams/${teamId}/members`), {
      params: toHttpParams({ limit: 100, offset: 0 }),
    });
  }

  /** Appends an agent to the end of the roster. */
  addMember(teamId: string, input: AddTeamMemberInput): Observable<TeamMember> {
    return this.http.post<TeamMember>(this.url(`/teams/${teamId}/members`), input);
  }

  /** Changes an agent's role. An explicit `null` clears the label. */
  updateMember(
    teamId: string,
    agentId: string,
    input: UpdateTeamMemberInput,
  ): Observable<TeamMember> {
    return this.http.patch<TeamMember>(this.url(`/teams/${teamId}/members/${agentId}`), input);
  }

  removeMember(teamId: string, agentId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/teams/${teamId}/members/${agentId}`));
  }

  /**
   * Rewrites the turn order.
   *
   * `agentIds` has to name exactly the agents currently on the team; the API
   * refuses anything else with a 409 rather than reordering around a member
   * the client did not know about.
   */
  reorderMembers(
    teamId: string,
    agentIds: readonly string[],
  ): Observable<PaginatedResponse<TeamMember>> {
    return this.http.put<PaginatedResponse<TeamMember>>(
      this.url(`/teams/${teamId}/members/order`),
      { agentIds },
    );
  }
}
