import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * The standard classification types for artifacts.
 *
 * As enumerated in `data/artifacts/artifacts.sql`:
 * - `document`: human-readable documents, reports, proposals, notes
 * - `code`: source files, patches, scripts, configuration manifests
 * - `file`: arbitrary binary files, archives, data dumps
 * - `structured`: JSON, CSV, YAML or tabular data structures
 */
export const ALLOWED_ARTIFACT_TYPES = [
  'document',
  'code',
  'file',
  'structured',
] as const;

export type ArtifactType = (typeof ALLOWED_ARTIFACT_TYPES)[number];

/** Longest artifact title the API accepts. */
export const MAX_ARTIFACT_TITLE_LENGTH = 200;

/** Longest MIME type string accepted. */
export const MAX_ARTIFACT_MIME_TYPE_LENGTH = 100;

/**
 * Longest inline artifact content accepted.
 *
 * Matches the message and memory content caps: the JSON body limit is sized so
 * 100 000 characters remain reachable, and larger payloads belong in `filePath`.
 */
export const MAX_ARTIFACT_CONTENT_LENGTH = 100_000;

/** Error message when both content and filePath are provided. */
export const BOTH_CONTENT_AND_FILE_ERROR_MESSAGE =
  'An artifact cannot define both content and filePath; specify either content (for inline text) or filePath (for stored files), but not both';

/** Error message when neither content nor filePath is provided. */
export const NEITHER_CONTENT_NOR_FILE_ERROR_MESSAGE =
  'An artifact must define exactly one of content (for inline text) or filePath (for stored files)';

/**
 * Trims string fields, leaving non-string values for the type validators.
 */
export function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Disallows a server-managed or internal field on a DTO.
 *
 * Declaring the field with this decorator turns client attempts to send it
 * into a clear 400 Bad Request error naming the property, instead of
 * generic non-whitelisted property rejections.
 */
export function DisallowField(
  errorMessage: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'disallowField',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return value === undefined;
        },
        defaultMessage() {
          return errorMessage;
        },
      },
    });
  };
}

/**
 * Validates that an artifact creation payload specifies either inline text (`content`)
 * or a stored file reference (`filePath`), but never both and never neither.
 */
export function ContentOrFilePathXor(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'contentOrFilePathXor',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const obj = args.object as Record<string, unknown>;
          const rawContent = obj?.content;
          const rawFilePath = obj?.filePath ?? obj?.file_path;

          const hasContent = rawContent !== undefined && rawContent !== null;
          const hasFilePath = rawFilePath !== undefined && rawFilePath !== null;

          if (hasContent && hasFilePath) {
            return false;
          }

          if (!hasContent && !hasFilePath) {
            return false;
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          const obj = args.object as Record<string, unknown>;
          const rawContent = obj?.content;
          const rawFilePath = obj?.filePath ?? obj?.file_path;
          const hasContent = rawContent !== undefined && rawContent !== null;
          const hasFilePath = rawFilePath !== undefined && rawFilePath !== null;

          if (hasContent && hasFilePath) {
            return BOTH_CONTENT_AND_FILE_ERROR_MESSAGE;
          }
          return NEITHER_CONTENT_NOR_FILE_ERROR_MESSAGE;
        },
      },
    });
  };
}

