import {
  BadRequestException,
  Injectable,
  ParseUUIDPipe,
  type ArgumentMetadata,
} from '@nestjs/common';

/**
 * Stable error code for a path parameter that is not a UUIDv7.
 */
export const INVALID_IDENTIFIER_CODE = 'INVALID_IDENTIFIER';

/**
 * Validates that a path parameter is a UUIDv7 before it reaches a service.
 *
 * Every identifier this API issues is a UUIDv7 (see `docs/api-conventions.md`),
 * so a value that is not one can never name an existing resource. Answering
 * `404` for it would tell the client "not here, maybe later"; the honest answer
 * is `400`, because the request itself is malformed. A v4 UUID is rejected as
 * well: `ORDER BY id` relies on the v7 timestamp prefix.
 *
 * The message names the parameter but never echoes the value, so a
 * client-controlled string of any length does not end up in the response or
 * the log. A well-formed id still reaches the service, which keeps answering
 * `404` for a real miss.
 */
@Injectable()
export class ParseUuidV7Pipe extends ParseUUIDPipe {
  constructor() {
    super({ version: '7' });
  }

  override async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<string> {
    if (typeof value === 'string' && this.isUUID(value, '7')) {
      return value;
    }

    const name = metadata.data ?? 'id';

    throw new BadRequestException({
      code: INVALID_IDENTIFIER_CODE,
      message: `${name} must be a UUIDv7`,
    });
  }
}
