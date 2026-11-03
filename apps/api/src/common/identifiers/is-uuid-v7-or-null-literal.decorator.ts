import { isUUID, ValidateBy, type ValidationOptions } from 'class-validator';

/**
 * Validates a query filter that takes either a UUIDv7 or the literal string
 * `null`.
 *
 * List endpoints use `?modelId=null` to match rows with no linked resource, so
 * a plain `@IsUUID('7')` would reject a documented filter. Anything else must be
 * a UUIDv7, the only kind of id the API issues.
 */
export function IsUuidV7OrNullLiteral(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isUuidV7OrNullLiteral',
      validator: {
        validate: (value: unknown): boolean =>
          value === 'null' || (typeof value === 'string' && isUUID(value, '7')),
        defaultMessage: (args): string =>
          `${args?.property ?? 'value'} must be a UUIDv7 or "null"`,
      },
    },
    validationOptions,
  );
}
