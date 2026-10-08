import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../../environments/environment';
import type { Budget as BudgetModel } from '../../core/api/budget.models';
import { Budget } from './budget';

const BUDGET_URL = `${environment.apiBaseUrl}/budget`;

const BUDGET: BudgetModel = {
  id: 'b1',
  limitUsd: 20,
  period: 'monthly',
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  spentUsd: 4.12,
  remainingUsd: 15.88,
  usedFraction: 0.206,
  callCount: 37,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-08T14:22:10.904Z',
};

const UNSET: BudgetModel = {
  ...BUDGET,
  limitUsd: null,
  spentUsd: 0,
  remainingUsd: null,
  usedFraction: null,
  callCount: 0,
};

function setup(budget: BudgetModel = BUDGET) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [Budget],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Budget);
  fixture.detectChanges();

  httpMock.expectOne(BUDGET_URL).flush(budget);
  fixture.detectChanges();

  const component = fixture.componentInstance as unknown as {
    form: { patchValue: (value: Record<string, unknown>) => void };
    buildPatch: () => Record<string, unknown>;
  };

  return { fixture, component, httpMock };
}

function text(fixture: { nativeElement: unknown }): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('Budget screen', () => {
  it('shows the figures for the current period', () => {
    const { fixture } = setup();

    expect(text(fixture)).toContain('15.88');
    expect(text(fixture)).toContain('4.12');
    expect(text(fixture)).toContain('37');
  });

  it('says no limit rather than showing a remainder of nothing', () => {
    const { fixture } = setup(UNSET);

    expect(text(fixture)).toContain('no limit');
  });

  it('states that nothing has been charged, rather than presenting a full budget as a measurement', () => {
    const { fixture } = setup({ ...BUDGET, spentUsd: 0, callCount: 0 });

    expect(text(fixture)).toContain('Nothing has been charged yet');
  });

  it('drops that notice once something has been recorded', () => {
    const { fixture } = setup();

    expect(text(fixture)).not.toContain('Nothing has been charged yet');
  });

  it('offers to remove a budget that is set, and not one that is not', () => {
    expect(text(setup().fixture)).toContain('Remove budget');
    expect(text(setup(UNSET).fixture)).not.toContain('Remove budget');
  });
});

describe('Budget patch building', () => {
  it('sends nothing when nothing changed', () => {
    const { component } = setup();

    expect(component.buildPatch()).toEqual({});
  });

  it('sends only the limit when only the limit changed', () => {
    const { component } = setup();
    component.form.patchValue({ limitUsd: 50 });

    expect(component.buildPatch()).toEqual({ limitUsd: 50 });
  });

  it('sends only the period when only the period changed', () => {
    const { component } = setup();
    component.form.patchValue({ period: 'daily' });

    expect(component.buildPatch()).toEqual({ period: 'daily' });
  });

  it('removes the budget when the field is emptied', () => {
    const { component } = setup();
    component.form.patchValue({ limitUsd: null });

    expect(component.buildPatch()).toEqual({ limitUsd: null });
  });

  it('sets a first budget from an empty field', () => {
    const { component } = setup(UNSET);
    component.form.patchValue({ limitUsd: 20 });

    expect(component.buildPatch()).toEqual({ limitUsd: 20 });
  });

  it('collects both fields into one body', () => {
    const { component } = setup();
    component.form.patchValue({ limitUsd: 5, period: 'weekly' });

    expect(component.buildPatch()).toEqual({ limitUsd: 5, period: 'weekly' });
  });
});
