import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * Message used when both agentId and teamId are provided.
 */
export const BOTH_OWNERS_ERROR_MESSAGE =
  'A chat cannot belong to both an agent and a team; specify either agentId or teamId, but not both';

/**
 * Message used when neither agentId nor teamId is provided.
 */
export const NEITHER_OWNER_ERROR_MESSAGE =
  'A chat must have an owner: specify either agentId or teamId';

/**
 * Message used when attempting to change the owner of a chat.
 */
export const OWNER_IMMUTABLE_ERROR_MESSAGE =
  'Changing the owner of a chat is not allowed: message history is tied to the original owner (agent or team)';

/**
 * Message used when attempting to set context_summary directly.
 */
export const CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE =
  'context_summary is read-only and cannot be set directly; it is managed by the compaction endpoint';

/**
 * Validates that an object has exactly one owner: either `agentId` or `teamId`.
 *
 * A class-level rule expressed as a property decorator, which is why it reads
 * both fields off `args.object` rather than looking at the value it is attached
 * to. Declaring it on the DTO means the rejection comes from the global
 * `ValidationPipe` with the field named, before any service runs; `ChatsService`
 * checks the same rule again for the paths that do not go through the pipe.
 *
 * The message distinguishes the four ways the rule can be broken — both owners,
 * neither, a non-string, and a blank string — since "specify either agentId or
 * teamId" is not useful feedback for a request that supplied one of them as an
 * empty string.
 */
export function ExactlyOneOwner(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'exactlyOneOwner',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const obj = args.object as Record<string, unknown>;
          const rawAgent = obj?.agentId;
          const rawTeam = obj?.teamId;
          const hasAgent = rawAgent !== undefined && rawAgent !== null;
          const hasTeam = rawTeam !== undefined && rawTeam !== null;

          if (hasAgent && hasTeam) {
            return false;
          }
          if (!hasAgent && !hasTeam) {
            return false;
          }

          if (hasAgent) {
            return typeof rawAgent === 'string' && rawAgent.trim().length > 0;
          }
          if (hasTeam) {
            return typeof rawTeam === 'string' && rawTeam.trim().length > 0;
          }

          return false;
        },
        defaultMessage(args: ValidationArguments) {
          const obj = args.object as Record<string, unknown>;
          const rawAgent = obj?.agentId;
          const rawTeam = obj?.teamId;
          const hasAgent = rawAgent !== undefined && rawAgent !== null;
          const hasTeam = rawTeam !== undefined && rawTeam !== null;

          if (hasAgent && hasTeam) {
            return BOTH_OWNERS_ERROR_MESSAGE;
          }
          if (!hasAgent && !hasTeam) {
            return NEITHER_OWNER_ERROR_MESSAGE;
          }
          if (hasAgent) {
            if (typeof rawAgent !== 'string') {
              return 'agentId must be a string';
            }
            return 'agentId must not be empty';
          }
          if (hasTeam) {
            if (typeof rawTeam !== 'string') {
              return 'teamId must be a string';
            }
            return 'teamId must not be empty';
          }
          return NEITHER_OWNER_ERROR_MESSAGE;
        },
      },
    });
  };
}

/**
 * Disallows a property entirely from being set in request payloads.
 *
 * Declaring a server-managed field on the DTO and then rejecting it is what
 * turns it into a 400 that names the field. Leaving it off the DTO would make
 * the global pipe's `forbidNonWhitelisted` report an unknown property instead,
 * which tells a client nothing about why the field it can see in responses
 * cannot be sent back.
 *
 * @param errorMessage - The message returned when the property is present; it
 * should say what manages the field instead.
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
