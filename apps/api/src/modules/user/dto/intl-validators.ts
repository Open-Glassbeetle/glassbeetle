import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * Whether ICU can resolve a BCP-47 language tag.
 *
 * Checked against the platform's own locale machinery rather than a regex: a
 * tag that is syntactically well-formed but unresolvable would otherwise be
 * accepted here and fail later, inside whichever `Intl` call formatted a date,
 * far away from the request that stored it.
 */
export function isResolvableLocale(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }

  try {
    return Intl.getCanonicalLocales(value).length > 0;
  } catch {
    return false;
  }
}

/**
 * Whether this process can resolve the value as a named time zone.
 *
 * Asked of `Intl.DateTimeFormat` rather than of a list, because what matters is
 * whether the running Node build can actually answer "what time is it for the
 * user" with this value. `Intl.supportedValuesOf('timeZone')` is a near miss:
 * it leaves out `UTC`, which is a legitimate zone and the one a server-minded
 * user is most likely to pick.
 *
 * A fixed UTC offset such as `+02:00` is rejected even though
 * `Intl.DateTimeFormat` accepts it. An offset does not track daylight saving,
 * so an agent resolving "tomorrow at nine" from one would be an hour wrong for
 * half the year — and the user would have no way to see why.
 */
export function isResolvableTimezone(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || /^[+-]/.test(trimmed)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a BCP-47 language tag, e.g. `de-CH`.
 */
export function IsResolvableLocale(
  options?: ValidationOptions,
): PropertyDecorator {
  return function (target: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isResolvableLocale',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => isResolvableLocale(value),
        defaultMessage: (args?: ValidationArguments) =>
          `${args?.property ?? 'value'} must be a BCP-47 language tag, for example 'de-CH'`,
      },
    });
  };
}

/**
 * Validates an IANA time zone name, e.g. `Europe/Zurich`.
 */
export function IsResolvableTimezone(
  options?: ValidationOptions,
): PropertyDecorator {
  return function (target: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isResolvableTimezone',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => isResolvableTimezone(value),
        defaultMessage: (args?: ValidationArguments) =>
          `${args?.property ?? 'value'} must be an IANA time zone name, for example 'Europe/Zurich'`,
      },
    });
  };
}
