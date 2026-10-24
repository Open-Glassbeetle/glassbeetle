import { beforeEach, describe, expect, it } from 'vitest';
import { UnsupportedProviderKindError } from '../errors/model-adapter-error.js';
import type { ModelAdapter } from '../model-adapter.interface.js';
import { TestDoubleAdapter } from '../test/test-double-adapter.js';
import type { AdapterConfig } from '../types/config.js';
import { AdapterFactoryService } from './adapter-factory.service.js';

describe('AdapterFactoryService', () => {
  let factory: AdapterFactoryService;

  beforeEach(() => {
    factory = new AdapterFactoryService();
  });

  it('registers and resolves an adapter for a single provider kind', () => {
    factory.register('anthropic', (config: AdapterConfig) => {
      return new TestDoubleAdapter(config, {
        cannedResponse: { model: 'claude-sonnet-5' },
      });
    });

    expect(factory.isSupported('anthropic')).toBe(true);
    expect(factory.isSupported('openai')).toBe(false);

    const adapter = factory.create({
      providerId: 'provider-1',
      providerKind: 'anthropic',
      apiKey: 'sk-ant-test',
    });

    expect(adapter).toBeDefined();
    expect(adapter.capabilities.supportsStreaming).toBe(true);
  });

  it('supports many-to-one mapping across multiple provider kinds', () => {
    let lastConstructedKind = '';
    const creator = (config: AdapterConfig): ModelAdapter => {
      lastConstructedKind = config.providerKind;
      return new TestDoubleAdapter(config);
    };

    factory.register(['openai', 'lmstudio', 'openai_compatible'], creator);

    expect(factory.isSupported('openai')).toBe(true);
    expect(factory.isSupported('lmstudio')).toBe(true);
    expect(factory.isSupported('openai_compatible')).toBe(true);

    const adapter1 = factory.create({
      providerId: 'p1',
      providerKind: 'lmstudio',
      baseUrl: 'http://localhost:1234',
    });
    expect(adapter1).toBeDefined();
    expect(lastConstructedKind).toBe('lmstudio');

    const adapter2 = factory.create({
      providerId: 'p2',
      providerKind: 'openai_compatible',
      baseUrl: 'https://custom-proxy.internal',
    });
    expect(adapter2).toBeDefined();
    expect(lastConstructedKind).toBe('openai_compatible');
  });

  it('throws UnsupportedProviderKindError with registered kinds for unknown provider kind', () => {
    factory.register('anthropic', (config) => new TestDoubleAdapter(config));
    factory.register('openai', (config) => new TestDoubleAdapter(config));

    expect(() =>
      factory.create({
        providerId: 'p-unknown',
        providerKind: 'unknown_vendor' as any,
      }),
    ).toThrow(UnsupportedProviderKindError);

    try {
      factory.create({
        providerId: 'p-unknown',
        providerKind: 'unknown_vendor' as any,
      });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(UnsupportedProviderKindError);
      const adapterErr = err as UnsupportedProviderKindError;
      expect(adapterErr.code).toBe('UNSUPPORTED_PROVIDER_KIND');
      expect(adapterErr.message).toContain('unknown_vendor');
      expect(adapterErr.message).toContain('anthropic, openai');
    }
  });

  it('unregisters an adapter', () => {
    factory.register('google', (config) => new TestDoubleAdapter(config));
    expect(factory.isSupported('google')).toBe(true);

    const unregistered = factory.unregister('google');
    expect(unregistered).toBe(true);
    expect(factory.isSupported('google')).toBe(false);
  });

  it('clears all registered adapters', () => {
    factory.register(['anthropic', 'openai'], (config) => new TestDoubleAdapter(config));
    expect(factory.getSupportedKinds()).toHaveLength(2);

    factory.clear();
    expect(factory.getSupportedKinds()).toHaveLength(0);
  });
});
