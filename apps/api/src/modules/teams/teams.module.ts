import { Module } from '@nestjs/common';
import { TeamMembersController } from './team-members/team-members.controller.js';
import { TeamMembersService } from './team-members/team-members.service.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

/**
 * Wires `/teams` and its roster sub-resource.
 *
 * Both controllers live here because a membership is not a resource of its
 * own: it has no id — `team_members` has the composite primary key
 * `(team_id, agent_id)` — and no meaning outside its team.
 *
 * Exports both services, since a chat can be owned by a team.
 */
@Module({
  controllers: [TeamsController, TeamMembersController],
  providers: [TeamsService, TeamMembersService],
  exports: [TeamsService, TeamMembersService],
})
export class TeamsModule {}
