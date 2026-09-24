import { Transform } from 'class-transformer';

/**
 * Parses a query string parameter ('true' / 'false' / '1' / '0') into a boolean.
 */
export function parseBooleanQueryParam(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }

  return undefined;
}

/**
 * Decorator to transform boolean query string parameters ('true', 'false', '1', '0')
 * into real boolean values before validation.
 */
export function TransformBoolean(): PropertyDecorator {
  return Transform(({ value }) => parseBooleanQueryParam(value));
}
