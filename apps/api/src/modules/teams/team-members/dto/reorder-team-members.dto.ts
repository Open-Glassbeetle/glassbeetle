import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

/**
 * Request payload for `PUT /teams/:teamId/members/order`.
 *
 * The whole roster is sent, not a move instruction. Positions are a dense
 * sequence, so every move renumbers several rows anyway; sending the intended
 * end state makes the write one transaction and makes a half-applied order
 * impossible. It also means a client whose view of the team is stale is
 * rejected rather than silently reordering rows it did not know about — the
 * list has to match the current membership exactly.
 */
export class ReorderTeamMembersDto {
  @ApiProperty({
    type: [String],
    description:
      'Every agent currently on the team, in the order they should take their turn',
    example: [
      '018f3a9e-0000-7000-8000-000000000002',
      '018f3a9e-0000-7000-8000-000000000003',
    ],
  })
  @IsArray({ message: 'agentIds must be an array' })
  @ArrayNotEmpty({ message: 'agentIds must not be empty' })
  @IsString({ each: true, message: 'agentIds must contain only strings' })
  agentIds!: string[];
}
