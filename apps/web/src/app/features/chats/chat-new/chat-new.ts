import {
  Component,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { Agent } from '../../../core/api/agents.models';
import {
  MAX_CHAT_TITLE_LENGTH,
  type Chat,
  type ChatOwner,
  type CreateChatInput,
} from '../../../core/api/chats.models';
import { ChatsService } from '../../../core/api/chats.service';
import { MessagesService } from '../../../core/api/messages.service';
import type { Team } from '../../../core/api/teams.models';
import { NotificationService } from '../../../core/notifications/notification.service';
import { CapabilitiesService } from '../../../core/platform/capabilities.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ChatRunsService } from '../../../core/workspace/chat-runs.service';
import { ConversationsService } from '../../../core/workspace/conversations.service';
import { ModelCatalogService } from '../../../core/workspace/model-catalog.service';
import { Avatar } from '../../../shared/ui/avatar';
import { Skeleton } from '../../../shared/ui/skeleton';
import { AgentAvatar } from '../../agents/agent-avatar/agent-avatar';
import { Composer } from '../composer/composer';

/** Where the last owner a chat was started with is remembered. */
const LAST_OWNER_KEY = 'glassbeetle.chat.lastOwner';

/** How much of the first line becomes the chat's title. */
const DERIVED_TITLE_LENGTH = 72;

/** The owner a new chat would go to, resolved to the thing itself. */
type Recipient =
  | { readonly kind: 'agent'; readonly agent: Agent; readonly model: string | null }
  | { readonly kind: 'team'; readonly team: Team };

function readLastOwner(): ChatOwner | null {
  try {
    const [kind, id] = (localStorage.getItem(LAST_OWNER_KEY) ?? '').split(':');
    return (kind === 'agent' || kind === 'team') && id ? { kind, id } : null;
  } catch {
    return null;
  }
}

/**
 * The title a chat gets from its first turn: the first line, cut at a word.
 *
 * Asking for a title before anything has been said is a form in the way of a
 * conversation, and an untitled chat is hard to find again. The first line is
 * what the conversation is about often enough, and it can be renamed.
 */
export function titleFromMessage(text: string): string {
  const line = (text.split('\n').find((candidate) => candidate.trim()) ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  if (line.length <= DERIVED_TITLE_LENGTH) {
    return line;
  }

  const cut = line.slice(0, DERIVED_TITLE_LENGTH);
  const space = cut.lastIndexOf(' ');

  return `${(space > DERIVED_TITLE_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * `/chats/new` — where the workspace opens: an empty conversation, ready to
 * be typed into.
 *
 * A chat is not created until there is something to say in it. Sending the
 * first turn creates the chat under the chosen agent or team, stores the turn,
 * asks for the reply and opens the conversation — one act for the user, which
 * is what starting a conversation should be.
 *
 * The owner is chosen here because the API will not move a conversation
 * afterwards: its history belongs to whoever produced it.
 */
@Component({
  selector: 'app-chat-new',
  imports: [
    AgentAvatar,
    Avatar,
    Composer,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './chat-new.html',
  styleUrl: './chat-new.scss',
})
export class ChatNew {
  private readonly chats = inject(ChatsService);
  private readonly messages = inject(MessagesService);
  private readonly runs = inject(ChatRunsService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly capabilities = inject(CapabilitiesService);
  private readonly models = inject(ModelCatalogService);
  protected readonly roster = inject(AgentRosterService);
  protected readonly conversations = inject(ConversationsService);

  /** Bound from `?agentId=` / `?teamId=`, set by an owner's own page. */
  readonly agentId = input<string>();
  readonly teamId = input<string>();
  /** Bound from `?projectId=`, set by a project's page. */
  readonly projectId = input<string>();

  private readonly composer = viewChild(Composer);

  protected readonly text = signal('');
  protected readonly sending = signal(false);

  /** What the user picked on this screen, which outranks every default. */
  private readonly chosenOwner = signal<ChatOwner | null>(null);
  private readonly chosenProject = signal<string | null | undefined>(undefined);

  protected readonly loaded = computed(() => this.roster.loaded() && this.conversations.loaded());

  /** Every agent, each with the model it runs on. */
  protected readonly agents = computed(() =>
    this.roster.agents().map((agent) => ({ agent, model: this.models.labelFor(agent) })),
  );

  protected readonly teams = this.conversations.teams;

  protected readonly hasOwners = computed(
    () => this.agents().length > 0 || this.teams().length > 0,
  );

  /**
   * Who the chat would be started with.
   *
   * In order: what was picked here, what the link that led here asked for, who
   * the last chat was started with, and otherwise the first agent that can
   * actually answer.
   */
  protected readonly recipient = computed<Recipient | null>(() => {
    const requested: ChatOwner | null = this.agentId()
      ? { kind: 'agent', id: this.agentId()! }
      : this.teamId()
        ? { kind: 'team', id: this.teamId()! }
        : null;

    for (const owner of [this.chosenOwner(), requested, readLastOwner()]) {
      const found = owner ? this.resolve(owner) : null;
      if (found) {
        return found;
      }
    }

    const agents = this.agents();
    const first = agents.find((entry) => entry.agent.modelId) ?? agents[0];

    if (first) {
      return { kind: 'agent', ...first };
    }

    const team = this.teams()[0];
    return team ? { kind: 'team', team } : null;
  });

  protected readonly recipientName = computed(() => {
    const recipient = this.recipient();
    return !recipient
      ? ''
      : recipient.kind === 'agent'
        ? recipient.agent.name
        : recipient.team.name;
  });

  /** The project the chat would be filed under, or `null` for none. */
  protected readonly project = computed(() => {
    const chosen = this.chosenProject();
    const projectId = chosen === undefined ? (this.projectId() ?? null) : chosen;

    return projectId
      ? (this.conversations.projects().find((project) => project.id === projectId) ?? null)
      : null;
  });

  /**
   * Why the chosen owner cannot answer, when that is already knowable.
   *
   * Said before the first turn is sent rather than after: the API would refuse
   * the run with the same reason, but by then the user has typed into a
   * conversation that cannot reply.
   */
  protected readonly obstacle = computed(() => {
    const recipient = this.recipient();

    if (recipient?.kind === 'agent') {
      return this.capabilities.modelsAvailable() && !recipient.agent.modelId
        ? {
            text: `${recipient.agent.name} has no model assigned, so it cannot reply yet.`,
            action: 'Assign a model',
            link: ['/agents', recipient.agent.id],
          }
        : null;
    }

    if (recipient?.kind === 'team' && recipient.team.memberCount === 0) {
      return {
        text: `${recipient.team.name} has no members, so nobody would take the turn.`,
        action: 'Add members',
        link: ['/teams', recipient.team.id],
      };
    }

    return null;
  });

  constructor() {
    // The screen exists to be typed into, so the cursor starts in the field.
    afterNextRender(() => this.composer()?.focus());
  }

  protected chooseAgent(agent: Agent): void {
    this.chosenOwner.set({ kind: 'agent', id: agent.id });
    this.composer()?.focus();
  }

  protected chooseTeam(team: Team): void {
    this.chosenOwner.set({ kind: 'team', id: team.id });
    this.composer()?.focus();
  }

  protected chooseProject(projectId: string | null): void {
    this.chosenProject.set(projectId);
    this.composer()?.focus();
  }

  /**
   * Starts the conversation with its first turn.
   *
   * The chat is opened as soon as it exists, even if storing the turn then
   * fails: the conversation is real by that point, and landing in it with the
   * failure reported is more use than staying on a screen that has already
   * created something.
   */
  protected async start(text: string): Promise<void> {
    const recipient = this.recipient();

    if (!recipient || this.sending()) {
      this.text.set(text);
      return;
    }

    this.sending.set(true);

    let chat: Chat;

    try {
      chat = await firstValueFrom(this.chats.create(this.buildInput(recipient, text)));
    } catch (error) {
      this.sending.set(false);
      // Nothing was created, so the turn goes back where it was typed.
      this.text.set(text);
      this.notify.error(error, 'Could not start the chat.');
      return;
    }

    this.remember(recipient);
    this.conversations.upsert(chat, true);

    try {
      await firstValueFrom(this.messages.create(chat.id, { content: text }));
      this.runs.start(chat.id);
    } catch (error) {
      this.notify.error(error, 'The chat was created, but the message could not be stored.');
    }

    void this.router.navigate(['/chats', chat.id]);
  }

  /**
   * Builds the request body.
   *
   * Exactly one owner key is sent: the API rejects a body carrying both, even
   * when one of them is null.
   */
  private buildInput(recipient: Recipient, text: string): CreateChatInput {
    const title = titleFromMessage(text).slice(0, MAX_CHAT_TITLE_LENGTH);
    const project = this.project();

    return {
      ...(recipient.kind === 'team'
        ? { teamId: recipient.team.id }
        : { agentId: recipient.agent.id }),
      ...(title ? { title } : {}),
      ...(project ? { projectId: project.id } : {}),
    };
  }

  private resolve(owner: ChatOwner): Recipient | null {
    if (owner.kind === 'agent') {
      const entry = this.agents().find((candidate) => candidate.agent.id === owner.id);
      return entry ? { kind: 'agent', ...entry } : null;
    }

    const team = this.teams().find((candidate) => candidate.id === owner.id);
    return team ? { kind: 'team', team } : null;
  }

  private remember(recipient: Recipient): void {
    try {
      localStorage.setItem(
        LAST_OWNER_KEY,
        recipient.kind === 'agent' ? `agent:${recipient.agent.id}` : `team:${recipient.team.id}`,
      );
    } catch {
      // Without storage the next chat falls back to the first runnable agent.
    }
  }
}
