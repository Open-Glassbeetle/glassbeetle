import type { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * Whether ICU can resolve a BCP-47 language tag.
 *
 * Mirrors the API's rule rather than replacing it: the server's check is the
 * one that protects the database, this one is here so a typo is caught in the
 * field instead of coming back as a 400.
 */
export function isResolvableLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length > 0;
  } catch {
    return false;
  }
}

/**
 * Whether this browser can resolve the value as a named time zone.
 *
 * A fixed UTC offset such as `+02:00` is refused, as it is server-side: an
 * offset does not track daylight saving, so an agent resolving "tomorrow
 * morning" from one would be an hour out for half the year.
 */
export function isResolvableTimezone(value: string): boolean {
  if (/^[+-]/.test(value)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Form validator for a language tag. An empty field is valid; it clears. */
export function localeValidator(control: AbstractControl): ValidationErrors | null {
  const value = (control.value ?? '').trim();
  return !value || isResolvableLocale(value) ? null : { locale: true };
}

/** Form validator for an IANA time zone. An empty field is valid; it clears. */
export function timezoneValidator(control: AbstractControl): ValidationErrors | null {
  const value = (control.value ?? '').trim();
  return !value || isResolvableTimezone(value) ? null : { timezone: true };
}

/** Every time zone this browser knows, for the field's suggestion list. */
export function knownTimezones(): readonly string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}
