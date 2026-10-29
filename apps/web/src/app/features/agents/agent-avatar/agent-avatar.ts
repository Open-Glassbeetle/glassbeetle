import { Component, computed, inject, input } from '@angular/core';

import { AgentsService } from '../../../core/api/agents.service';
import { Avatar } from '../../../shared/ui/avatar';

/**
 * An agent's avatar.
 *
 * When the agent has a stored picture, the URL is handed to `gb-avatar`, which
 * falls back to initials if the image fails to load. `hasPicture` on the agent
 * is the signal for whether to build a URL at all.
 */
@Component({
  selector: 'app-agent-avatar',
  imports: [Avatar],
  template: ` <gb-avatar [name]="name()" [imageUrl]="imageUrl()" [size]="size()" /> `,
})
export class AgentAvatar {
  private readonly agents = inject(AgentsService);

  readonly name = input.required<string>();
  /** Agent whose picture to show; omit or pass null for initials only. */
  readonly agent = input<{
    id: string;
    hasPicture: boolean;
    updatedAt: string;
  } | null>(null);
  readonly size = input<'small' | 'normal' | 'large'>('normal');

  protected readonly imageUrl = computed(() => this.agents.pictureUrl(this.agent()));
}
