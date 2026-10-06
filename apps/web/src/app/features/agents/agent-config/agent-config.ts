import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Panel } from '../../../shared/ui/panel';

import type { Agent, UpdateAgentInput } from '../../../core/api/agents.models';
import { AgentsService } from '../../../core/api/agents.service';
import type { SystemPrompt } from '../../../core/api/system-prompts.models';
import { CapabilitiesService } from '../../../core/platform/capabilities.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import {
  formatModelParams,
  modelParamsValidator,
  parseModelParams,
} from './model-params.validator';

/** Sentinel for "no system prompt", since a `mat-select` cannot hold `null`. */
const NONE = '';

/**
 * The agent's configuration form.
 *
 * Saves a PATCH containing only the fields the user changed, with an explicit
 * `null` for the ones they cleared — which is how the API distinguishes "leave
 * this alone" from "unset this".
 */
@Component({
  selector: 'app-agent-config',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    Panel,
    ReactiveFormsModule,
  ],
  templateUrl: './agent-config.html',
  styleUrl: './agent-config.scss',
})
export class AgentConfig {
  private readonly agents = inject(AgentsService);
  private readonly notify = inject(NotificationService);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly capabilities = inject(CapabilitiesService);

  readonly agent = input.required<Agent>();
  readonly systemPrompts = input<readonly SystemPrompt[]>([]);

  /** Emits the server's updated representation after a successful save. */
  readonly saved = output<Agent>();

  protected readonly none = NONE;
  protected readonly saving = signal(false);

  protected readonly modelPlaceholder = computed(() =>
    this.capabilities.modelsAvailable() ? 'claude-sonnet-5' : 'Unavailable',
  );

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
    personality: [''],
    instructions: [''],
    systemPromptId: [NONE],
    modelId: [''],
    temperature: [null as number | null, [Validators.min(0), Validators.max(2)]],
    maxTokens: [null as number | null, [Validators.min(1)]],
    modelParams: ['', [modelParamsValidator]],
  });

  /** The agent the form currently holds, so a re-seed can tell a swap from a refresh. */
  private seededId: string | null = null;

  constructor() {
    // `agents.model_id` is a foreign key into `models`, and the agents endpoint
    // rejects any value that is not a real row with a 422. With no models
    // endpoint there is nothing to reference, so an editable field here could
    // only ever produce an error the user cannot avoid.
    effect(() => {
      const control = this.form.controls.modelId;

      if (this.capabilities.modelsAvailable()) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    });

    effect(() => {
      const agent = this.agent();

      // The parent replaces the agent after a save and after a picture upload.
      // Re-seeding unconditionally would throw away edits the user had typed
      // but not saved when they uploaded a picture, so the form is only
      // refilled when it is showing a different agent or has nothing to lose.
      if (agent.id !== this.seededId || this.form.pristine) {
        this.reset(agent);
      }
    });
  }

  protected reset(agent: Agent = this.agent()): void {
    this.seededId = agent.id;
    this.form.reset({
      name: agent.name,
      personality: agent.personality ?? '',
      instructions: agent.instructions ?? '',
      systemPromptId: agent.systemPromptId ?? NONE,
      modelId: agent.modelId ?? '',
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      modelParams: formatModelParams(agent.modelParams),
    });
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const patch = this.buildPatch();

    if (Object.keys(patch).length === 0) {
      this.notify.success('Nothing to save.');
      return;
    }

    const agentId = this.agent().id;
    this.saving.set(true);

    this.agents.update(agentId, patch).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.notify.success('Agent saved.');

        // Marked pristine before emitting so the effect above recognises that
        // there is nothing left to lose and re-seeds the form from the server's
        // representation rather than leaving the typed values in place.
        this.form.markAsPristine();
        this.saved.emit(updated);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notify.error(error, 'Could not save the agent.');
      },
    });
  }

  /**
   * Builds the PATCH body.
   *
   * A field left as it was is omitted, so the API's "empty body is a no-op"
   * rule keeps `updated_at` honest. A field the user emptied is sent as `null`,
   * which is what clears the column — sending `''` would store an empty string
   * instead, and the API would then report the field as set.
   */
  private buildPatch(): UpdateAgentInput {
    const value = this.form.getRawValue();
    const agent = this.agent();
    const patch: UpdateAgentInput = {};

    const name = value.name.trim();
    if (name !== agent.name) {
      patch.name = name;
    }

    assignText(patch, 'personality', value.personality, agent.personality);
    assignText(patch, 'instructions', value.instructions, agent.instructions);
    assignText(patch, 'modelId', value.modelId, agent.modelId);

    const systemPromptId = value.systemPromptId || null;
    if (systemPromptId !== agent.systemPromptId) {
      patch.systemPromptId = systemPromptId;
    }

    const temperature = value.temperature ?? null;
    if (temperature !== agent.temperature) {
      patch.temperature = temperature;
    }

    const maxTokens = value.maxTokens ?? null;
    if (maxTokens !== agent.maxTokens) {
      patch.maxTokens = maxTokens;
    }

    const modelParams = parseModelParams(value.modelParams);
    if (JSON.stringify(modelParams ?? null) !== JSON.stringify(agent.modelParams ?? null)) {
      patch.modelParams = modelParams;
    }

    return patch;
  }
}

type TextField = 'personality' | 'instructions' | 'modelId';

/** Adds a nullable text column to the patch when it differs from the stored value. */
function assignText(
  patch: UpdateAgentInput,
  field: TextField,
  value: string,
  stored: string | null,
): void {
  const next = value.trim() || null;

  if (next !== stored) {
    patch[field] = next;
  }
}
