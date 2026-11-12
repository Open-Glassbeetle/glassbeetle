import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';

import { ARTIFACT_TYPES, artifactIcon, type Artifact } from '../../../core/api/artifacts.models';
import { ArtifactsService } from '../../../core/api/artifacts.service';
import { PAGE_SIZE_OPTIONS } from '../../../core/api/pagination';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ConversationsService } from '../../../core/workspace/conversations.service';
import { ListState } from '../../../shared/list-state/list-state';
import { RelativeTimePipe } from '../../../shared/relative-time/relative-time.pipe';
import { Panel } from '../../../shared/ui/panel';
import { Skeleton } from '../../../shared/ui/skeleton';

/**
 * `/artifacts` — what agents produced, across every conversation.
 *
 * Read-only on purpose: an artifact is written by an agent in a chat, so the
 * way to make one is to ask for it there. This page is where the results are
 * found again once the conversation has moved on.
 */
@Component({
  selector: 'app-artifact-list',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatSelectModule,
    Panel,
    RelativeTimePipe,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './artifact-list.html',
  styleUrl: './artifact-list.scss',
})
export class ArtifactList {
  private readonly artifacts = inject(ArtifactsService);
  private readonly roster = inject(AgentRosterService);
  private readonly conversations = inject(ConversationsService);

  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly types = ARTIFACT_TYPES;

  /** `''` is every type. */
  protected readonly typeFilter = signal('');

  protected readonly list = new ListState<Artifact, { type?: string }>({
    load: (query) => this.artifacts.list(query),
    extraParams: () => (this.typeFilter() ? { type: this.typeFilter() } : {}),
    initialSort: 'updatedAt',
    initialOrder: 'desc',
  });

  /** Each artifact with the names of where it came from, when still known. */
  protected readonly entries = computed(() => {
    const agents = this.roster.agents();

    return this.list.items().map((artifact) => ({
      artifact,
      icon: artifactIcon(artifact.type),
      agent: artifact.agentId
        ? (agents.find((agent) => agent.id === artifact.agentId)?.name ?? null)
        : null,
      project: artifact.projectId ? this.conversations.projectName(artifact.projectId) : null,
    }));
  });

  protected readonly filtered = computed(() => this.typeFilter() !== '' || !!this.list.search());

  protected setType(type: string): void {
    this.typeFilter.set(type);
    this.list.resetPage();
  }

  protected clearFilters(): void {
    this.typeFilter.set('');
    this.list.clearSearch();
  }
}
