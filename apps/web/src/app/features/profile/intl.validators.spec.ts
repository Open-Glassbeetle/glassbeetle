import { FormControl } from '@angular/forms';

import {
  isResolvableLocale,
  isResolvableTimezone,
  knownTimezones,
  localeValidator,
  timezoneValidator,
} from './intl.validators';

describe('isResolvableLocale', () => {
  it.each(['de', 'de-CH', 'en-US', 'pt-BR'])('accepts %s', (value) => {
    expect(isResolvableLocale(value)).toBe(true);
  });

  it.each(['de_CH!', 'definitely not a locale', '123'])('rejects %s', (value) => {
    expect(isResolvableLocale(value)).toBe(false);
  });
});

describe('isResolvableTimezone', () => {
  it.each(['Europe/Zurich', 'America/New_York', 'UTC'])('accepts %s', (value) => {
    expect(isResolvableTimezone(value)).toBe(true);
  });

  it('rejects a zone the platform does not know', () => {
    expect(isResolvableTimezone('Mars/Olympus_Mons')).toBe(false);
  });

  it('rejects a fixed offset, which does not track daylight saving', () => {
    expect(isResolvableTimezone('+02:00')).toBe(false);
    expect(isResolvableTimezone('-05:00')).toBe(false);
  });
});

describe('form validators', () => {
  it('treat an empty field as valid, because empty clears the field', () => {
    expect(localeValidator(new FormControl(''))).toBeNull();
    expect(timezoneValidator(new FormControl('   '))).toBeNull();
  });

  it('report the field that is wrong', () => {
    expect(localeValidator(new FormControl('nope!'))).toEqual({ locale: true });
    expect(timezoneValidator(new FormControl('+02:00'))).toEqual({ timezone: true });
  });

  it('pass a value the API would accept', () => {
    expect(localeValidator(new FormControl('de-CH'))).toBeNull();
    expect(timezoneValidator(new FormControl('Europe/Zurich'))).toBeNull();
  });
});

describe('knownTimezones', () => {
  it('offers the platform list for the field to suggest from', () => {
    const zones = knownTimezones();

    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toContain('Europe/Zurich');
  });
});
