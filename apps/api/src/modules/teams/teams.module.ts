import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';
import { TeamMembersController } from './team-members/team-members.controller.js';
import { TeamMembersService } from './team-members/team-members.service.js';

@Module({
  controllers: [TeamsController, TeamMembersController],
  providers: [TeamsService, TeamMembersService]
})
export class TeamsModule {}
