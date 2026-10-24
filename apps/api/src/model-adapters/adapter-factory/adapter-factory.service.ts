import { Injectable } from '@nestjs/common';
import type { ProviderKind } from '../../modules/providers/dto/provider.dto.js';
import { UnsupportedProviderKindError } from '../errors/model-adapter-error.js';
import type { ModelAdapter, ModelAdapterCreator } from '../model-adapter.interface.js';
import type { AdapterConfig } from '../types/config.js';

/**
 * Factory service responsible for resolving and instantiating {@link ModelAdapter} instances.
 *
 * Provides a dynamic registry pattern so individual provider adapters (Anthropic,
 * OpenAI, Google, Ollama, etc.) can register independently without modifying
 * a centralized switch statement.
 *
 * Supports many-to-one mapping (e.g. `lmstudio` and `openai_compatible` both mapping
 * to an OpenAI protocol adapter).
 */
@Injectable()
export class AdapterFactoryService {
  private readonly registry = new Map<string, ModelAdapterCreator>();

  /**
   * Registers an adapter creator function for one or more provider kinds.
   *
   * @param kind - Single provider kind or array of kinds (for many-to-one mapping).
   * @param creator - Factory function that constructs the {@link ModelAdapter}.
   */
  register(
    kind: ProviderKind | string | readonly (ProviderKind | string)[],
    creator: ModelAdapterCreator,
  ): this {
    const kinds = Array.isArray(kind) ? kind : [kind];
    for (const k of kinds) {
      this.registry.set(k, creator);
    }
    return this;
  }

  /**
   * Unregisters an adapter creator for a provider kind.
   */
  unregister(kind: ProviderKind | string): boolean {
    return this.registry.delete(kind);
  }

  /**
   * Clears all registered adapter creators.
   */
  clear(): void {
    this.registry.clear();
  }

  /**
   * Checks whether an adapter is registered for the specified provider kind.
   */
  isSupported(kind: string): boolean {
    return this.registry.has(kind);
  }

  /**
   * Returns a list of all currently registered provider kinds.
   */
  getSupportedKinds(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * Instantiates the registered {@link ModelAdapter} for the given provider configuration.
   *
   * @param config - Provider configuration including decrypted credentials and base URL.
   * @returns An instantiated {@link ModelAdapter}.
   * @throws UnsupportedProviderKindError if no adapter has been registered for `config.providerKind`.
   */
  create(config: AdapterConfig): ModelAdapter {
    const creator = this.registry.get(config.providerKind);
    if (!creator) {
      throw new UnsupportedProviderKindError(
        config.providerKind,
        this.getSupportedKinds(),
      );
    }

    return creator(config);
  }
}
