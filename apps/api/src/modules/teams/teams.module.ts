import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { TeamMembersController } from './team-members/team-members.controller';
import { TeamMembersService } from './team-members/team-members.service';

@Module({
  controllers: [TeamsController, TeamMembersController],
  providers: [TeamsService, TeamMembersService]
})
export class TeamsModule {}
