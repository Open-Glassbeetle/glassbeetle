import { Module } from '@nestjs/common';
import { TeamMembersController } from './team-members/team-members.controller.js';
import { TeamMembersService } from './team-members/team-members.service.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

@Module({
  controllers: [TeamsController, TeamMembersController],
  providers: [TeamsService, TeamMembersService],
  exports: [TeamsService, TeamMembersService],
})
export class TeamsModule {}
