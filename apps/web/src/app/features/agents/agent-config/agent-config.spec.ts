import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import type { Agent } from '../../../core/api/agents.models';
import { AgentConfig } from './agent-config';

const AGENT: Agent = {
  id: 'agent-1',
  name: 'Research Assistant',
  personality: 'Friendly and methodical.',
  instructions: 'Cite sources.',
  systemPromptId: 'prompt-1',
  modelId: null,
  temperature: 0.7,
  maxTokens: 4096,
  modelParams: { top_p: 0.9 },
  hasPicture: false,
  createdAt: '2026-10-04T12:00:00.000Z',
  updatedAt: '2026-10-04T12:00:00.000Z',
};

/**
 * Builds the component with the agent seeded, and exposes the two internals the
 * patch logic is worth testing through: the form and `buildPatch`.
 */
function setup(agent: Agent = AGENT) {
  TestBed.configureTestingModule({
    imports: [AgentConfig],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  const fixture = TestBed.createComponent(AgentConfig);
  fixture.componentRef.setInput('agent', agent);
  fixture.detectChanges();

  const component = fixture.componentInstance as unknown as {
    form: {
      patchValue: (value: Record<string, unknown>) => void;
      getRawValue: () => Record<string, unknown>;
    };
    buildPatch: () => Record<string, unknown>;
  };

  return { fixture, component };
}

describe('AgentConfig patch building', () => {
  it('sends nothing when nothing changed', () => {
    const { component } = setup();

    // An empty body is an explicit no-op for the API, which then leaves
    // `updated_at` alone — so saving an untouched form must not look like an
    // edit.
    expect(component.buildPatch()).toEqual({});
  });

  it('sends only the fields that changed', () => {
    const { component } = setup();
    component.form.patchValue({ name: 'Lead Researcher' });

    expect(component.buildPatch()).toEqual({ name: 'Lead Researcher' });
  });

  it('clears an emptied text field with null, not an empty string', () => {
    const { component } = setup();
    component.form.patchValue({ personality: '   ' });

    // `''` would store an empty string and the API would report the field as
    // set; `null` is what actually clears the column.
    expect(component.buildPatch()).toEqual({ personality: null });
  });

  it('clears the system prompt link when the "no template" option is picked', () => {
    const { component } = setup();
    component.form.patchValue({ systemPromptId: '' });

    expect(component.buildPatch()).toEqual({ systemPromptId: null });
  });

  it('clears numeric fields with null when they are emptied', () => {
    const { component } = setup();
    component.form.patchValue({ temperature: null, maxTokens: null });

    expect(component.buildPatch()).toEqual({
      temperature: null,
      maxTokens: null,
    });
  });

  it('ignores reformatting of modelParams that does not change the value', () => {
    const { component } = setup();
    component.form.patchValue({ modelParams: '{"top_p":0.9}' });

    // The editor pretty-prints what it loaded, so the string differs from what
    // the user sees even when the object is identical. Comparing the parsed
    // value keeps that from counting as an edit.
    expect(component.buildPatch()).toEqual({});
  });

  it('sends modelParams when the object actually changes', () => {
    const { component } = setup();
    component.form.patchValue({ modelParams: '{"top_p":0.5}' });

    expect(component.buildPatch()).toEqual({ modelParams: { top_p: 0.5 } });
  });

  it('clears modelParams with null when the editor is emptied', () => {
    const { component } = setup();
    component.form.patchValue({ modelParams: '' });

    expect(component.buildPatch()).toEqual({ modelParams: null });
  });

  it('trims the name before comparing, so whitespace alone is not an edit', () => {
    const { component } = setup();
    component.form.patchValue({ name: '  Research Assistant  ' });

    expect(component.buildPatch()).toEqual({});
  });
});
