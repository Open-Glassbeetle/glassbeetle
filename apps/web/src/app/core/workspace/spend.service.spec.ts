import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import type { Budget } from '../api/budget.models';
import { SpendService } from './spend.service';

const BUDGET_URL = `${environment.apiBaseUrl}/budget`;

const BUDGET: Budget = {
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

function setup(budget?: Partial<Budget>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const service = TestBed.inject(SpendService);

  if (budget !== undefined) {
    service.set({ ...BUDGET, ...budget });
  }

  return { service, httpMock };
}

describe('SpendService', () => {
  describe('level', () => {
    it('is unset before anything is loaded', () => {
      expect(setup().service.level()).toBe('unset');
    });

    it('is unset when no limit is set, however much was spent', () => {
      const { service } = setup({ limitUsd: null, usedFraction: null, spentUsd: 99 });

      expect(service.level()).toBe('unset');
      expect(service.hasLimit()).toBe(false);
    });

    it('is within while there is comfortable room', () => {
      expect(setup({ usedFraction: 0.2 }).service.level()).toBe('within');
    });

    it('warns from four fifths of the budget', () => {
      expect(setup({ usedFraction: 0.79 }).service.level()).toBe('within');
      expect(setup({ usedFraction: 0.8 }).service.level()).toBe('warning');
    });

    it('is over exactly at the limit, not only past it', () => {
      expect(setup({ usedFraction: 1 }).service.level()).toBe('over');
      expect(setup({ usedFraction: 1.25 }).service.level()).toBe('over');
    });
  });

  describe('fraction', () => {
    it('clamps the ring where the figures are not clamped', () => {
      // A ring cannot draw 125%; the colour and the amount carry the overage.
      expect(setup({ usedFraction: 1.25 }).service.fraction()).toBe(1);
    });

    it('never goes below zero', () => {
      expect(setup({ usedFraction: -0.5 }).service.fraction()).toBe(0);
    });

    it('is zero before anything is loaded', () => {
      expect(setup().service.fraction()).toBe(0);
    });
  });

  describe('hasRecordedSpend', () => {
    it('is false when the period has no chargeable event, which is every install today', () => {
      expect(setup({ callCount: 0 }).service.hasRecordedSpend()).toBe(false);
    });

    it('is true once something has been charged', () => {
      expect(setup({ callCount: 1 }).service.hasRecordedSpend()).toBe(true);
    });
  });

  describe('money', () => {
    it('formats an amount as dollars', () => {
      expect(setup().service.money(15.88)).toContain('15.88');
    });

    it('keeps a sub-cent amount visible instead of rounding it to nothing', () => {
      // A single completion can cost a fraction of a cent, and $0.00 would be
      // a meter that never moves.
      expect(setup().service.money(0.0004)).not.toBe('$0.00');
    });

    it('shows a true zero as zero', () => {
      expect(setup().service.money(0)).toContain('0.00');
    });
  });

  describe('refresh', () => {
    it('loads the budget and marks itself loaded', () => {
      const { service, httpMock } = setup();

      service.refresh();
      httpMock.expectOne(BUDGET_URL).flush(BUDGET);

      expect(service.budget()).toEqual(BUDGET);
      expect(service.loaded()).toBe(true);
    });

    it('settles without a budget when the request fails, so the deck simply shows no meter', () => {
      const { service, httpMock } = setup();

      service.refresh();
      httpMock
        .expectOne(BUDGET_URL)
        .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

      expect(service.budget()).toBeNull();
      expect(service.hasLimit()).toBe(false);
      expect(service.loaded()).toBe(true);
    });
  });
});
