import { Pipe, PipeTransform } from '@angular/core';

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * Formats an ISO-8601 timestamp as "3 days ago".
 *
 * Deliberately impure-free: the value is computed once per change detection
 * from the input string, so a list of a hundred rows does not schedule a
 * hundred timers. Exact timestamps stay available in the `title` attribute
 * wherever this is used.
 */
@Pipe({ name: 'relativeTime' })
export class RelativeTimePipe implements PipeTransform {
  private readonly formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: 'auto',
  });

  transform(value: string | null | undefined): string {
    if (!value) {
      return '—';
    }

    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return value;
    }

    const elapsed = timestamp - Date.now();
    const magnitude = Math.abs(elapsed);

    for (const [unit, ms] of UNITS) {
      if (magnitude >= ms) {
        return this.formatter.format(Math.round(elapsed / ms), unit);
      }
    }

    return this.formatter.format(Math.round(elapsed / 1000), 'second');
  }
}
