import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../../environments/environment';
import type { UserProfile } from '../../core/api/user.models';
import { Profile } from './profile';

const USER_URL = `${environment.apiBaseUrl}/user`;

const PROFILE: UserProfile = {
  id: 'u1',
  displayName: 'Ada',
  pronouns: 'she/her',
  about: 'Works on Glassbeetle.',
  locale: 'de-CH',
  timezone: 'Europe/Zurich',
  includeInPrompts: true,
  hasPicture: false,
  pictureUpdatedAt: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

/**
 * Builds the screen with the profile loaded, and exposes the two internals the
 * patch logic is worth testing through: the form and `buildPatch`.
 */
function setup(profile: UserProfile = PROFILE) {
  TestBed.configureTestingModule({
    imports: [Profile],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Profile);
  fixture.detectChanges();

  httpMock.expectOne(USER_URL).flush(profile);
  fixture.detectChanges();

  const component = fixture.componentInstance as unknown as {
    form: {
      patchValue: (value: Record<string, unknown>) => void;
      dirty: boolean;
    };
    buildPatch: () => Record<string, unknown>;
    useMachineSettings: () => void;
  };

  return { fixture, component, httpMock };
}

describe('Profile', () => {
  it('loads the profile without needing it to exist first', () => {
    const { fixture } = setup();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Ada');
  });

  it('falls back to "You" when the name has been cleared', () => {
    const { fixture } = setup({ ...PROFILE, displayName: null });

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('You');
  });
});

describe('Profile patch building', () => {
  it('sends nothing when nothing changed', () => {
    const { component } = setup();

    // An empty body is an explicit no-op for the API, which then leaves
    // `updatedAt` alone — so saving an untouched form must not look like an
    // edit.
    expect(component.buildPatch()).toEqual({});
  });

  it('sends only the fields that changed', () => {
    const { component } = setup();
    component.form.patchValue({ displayName: 'Grace' });

    expect(component.buildPatch()).toEqual({ displayName: 'Grace' });
  });

  it('clears an emptied field with null, not an empty string', () => {
    const { component } = setup();
    component.form.patchValue({ about: '   ' });

    // `''` would be stored and then reported as set; `null` is what clears it.
    expect(component.buildPatch()).toEqual({ about: null });
  });

  it('trims a field rather than storing the whitespace around it', () => {
    const { component } = setup();
    component.form.patchValue({ displayName: '  Grace  ' });

    expect(component.buildPatch()).toEqual({ displayName: 'Grace' });
  });

  it('does not report a field retyped to the value it already had', () => {
    const { component } = setup();
    component.form.patchValue({ displayName: 'Ada', pronouns: 'she/her' });

    expect(component.buildPatch()).toEqual({});
  });

  it('sends the prompt-sharing flag as a boolean', () => {
    const { component } = setup();
    component.form.patchValue({ includeInPrompts: false });

    expect(component.buildPatch()).toEqual({ includeInPrompts: false });
  });

  it('collects several edits into one body', () => {
    const { component } = setup();
    component.form.patchValue({
      displayName: 'Grace',
      locale: 'en-GB',
      includeInPrompts: false,
    });

    expect(component.buildPatch()).toEqual({
      displayName: 'Grace',
      locale: 'en-GB',
      includeInPrompts: false,
    });
  });

  it('fills language and time zone from the machine when asked', () => {
    const { component } = setup({ ...PROFILE, locale: null, timezone: null });
    const machine = Intl.DateTimeFormat().resolvedOptions();

    component.useMachineSettings();

    expect(component.buildPatch()).toEqual({
      locale: machine.locale,
      timezone: machine.timeZone,
    });
    expect(component.form.dirty).toBe(true);
  });
});
