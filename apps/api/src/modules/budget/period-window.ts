/**
 * Periods a budget can run on.
 */
export const BUDGET_PERIODS = ['daily', 'weekly', 'monthly'] as const;

export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

/**
 * A half-open window of time, `[start, end)`, as ISO-8601 UTC strings.
 *
 * Half-open because spend is summed with `occurred_at >= start AND
 * occurred_at < end`: an event at the exact instant a period rolls over
 * belongs to the new period, and belongs to exactly one of them.
 */
export interface PeriodWindow {
  readonly start: string;
  readonly end: string;
}

/**
 * A civil date — a calendar day with no time zone attached.
 */
interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * The window the given instant falls in, anchored to the user's own day.
 *
 * A budget resets at local midnight, not at UTC midnight. For a monthly
 * budget that is a detail nobody would notice; for a daily one it is the
 * difference between the allowance renewing when the user wakes up and
 * renewing at two in the afternoon. The time zone comes from the user
 * profile, which is why that field exists.
 *
 * An unusable or missing zone falls back to UTC rather than throwing. The
 * profile validates the zone on the way in, so this only happens to a
 * hand-edited database — and reporting the wrong day is a better failure than
 * refusing to report spend at all.
 */
export function periodWindow(
  period: BudgetPeriod,
  now: Date,
  timeZone: string | null | undefined,
): PeriodWindow {
  const zone = usableZone(timeZone);
  const today = civilDateIn(now, zone);

  const start = startCivilDate(period, today);
  const end = advance(period, start);

  return {
    start: instantAtCivilMidnight(start, zone).toISOString(),
    end: instantAtCivilMidnight(end, zone).toISOString(),
  };
}

/**
 * The civil date a period containing `today` starts on.
 */
function startCivilDate(period: BudgetPeriod, today: CivilDate): CivilDate {
  switch (period) {
    case 'daily':
      return today;
    case 'weekly':
      // ISO weeks start on Monday. `getUTCDay()` counts from Sunday, so the
      // shift turns Monday into 0 and Sunday into 6.
      return addDays(today, -((utcDate(today).getUTCDay() + 6) % 7));
    case 'monthly':
      return { ...today, day: 1 };
  }
}

/**
 * The civil date the next period starts on.
 */
function advance(period: BudgetPeriod, start: CivilDate): CivilDate {
  switch (period) {
    case 'daily':
      return addDays(start, 1);
    case 'weekly':
      return addDays(start, 7);
    case 'monthly':
      return start.month === 12
        ? { year: start.year + 1, month: 1, day: 1 }
        : { ...start, month: start.month + 1, day: 1 };
  }
}

/**
 * Calendar arithmetic on a civil date, with no zone involved.
 *
 * Done through `Date.UTC` so month lengths and leap years are the platform's
 * problem rather than this module's.
 */
function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(utcDate(date).getTime() + days * 86_400_000);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function utcDate(date: CivilDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

/**
 * The calendar day an instant falls on, in the given zone.
 */
function civilDateIn(instant: Date, timeZone: string): CivilDate {
  const parts = partsIn(instant, timeZone);

  return { year: parts.year, month: parts.month, day: parts.day };
}

/**
 * The instant at which a civil date begins in the given zone.
 *
 * Solved rather than looked up: the offset to apply depends on the instant,
 * and the instant is what is being computed. The first pass guesses with the
 * offset in force at the equivalent UTC time, the second corrects it with the
 * offset actually in force at the candidate — which is what makes the day
 * after a daylight-saving change come out right.
 *
 * In a zone whose clocks jump at midnight, that local midnight does not exist
 * and the result is the first instant of the day that does. That is the
 * sensible reading of "when the day starts", and the alternative is refusing
 * to answer.
 */
function instantAtCivilMidnight(date: CivilDate, timeZone: string): Date {
  const asIfUtc = utcDate(date).getTime();
  const firstGuess = asIfUtc - zoneOffsetMs(new Date(asIfUtc), timeZone);
  const corrected = asIfUtc - zoneOffsetMs(new Date(firstGuess), timeZone);

  return new Date(corrected);
}

/**
 * How far ahead of UTC the zone is at a given instant, in milliseconds.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = partsIn(instant, timeZone);

  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  // Both sides are whole seconds, so the instant's own milliseconds have to be
  // dropped from the comparison or every offset would carry them as noise.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

interface ZonedParts extends CivilDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * The instant's wall-clock reading in the zone.
 *
 * Formatters are cached because this runs several times per request and
 * constructing one is the expensive part of the calculation.
 */
function partsIn(instant: Date, timeZone: string): ZonedParts {
  let formatter = PART_FORMATTERS.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PART_FORMATTERS.set(timeZone, formatter);
  }

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }

  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/**
 * The zone to use, falling back to UTC when the stored one cannot be resolved.
 */
function usableZone(timeZone: string | null | undefined): string {
  if (!timeZone) {
    return 'UTC';
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}
