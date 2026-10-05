import { HttpStatus } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The single error shape every endpoint in the API returns.
 *
 * Clients branch on `code`, not on `message`: `code` is stable and
 * machine-readable, while `message` is human-facing and may be reworded at any
 * time. `details` carries per-field validation failures and is absent for
 * errors that have none.
 */
export interface ApiErrorResponse {
  /** HTTP status code, repeated in the body so a logged response is self-contained. */
  statusCode: number;
  /** Human-readable name of the status, e.g. `Not Found`. */
  error: string;
  /** Stable machine-readable code, e.g. `NOT_FOUND`. */
  code: string;
  /** Human-readable description of what went wrong. */
  message: string;
  /** Per-field detail, present for validation failures. */
  details?: string[];
  /** Request path the error occurred on. */
  path: string;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
}

/**
 * Reusable DTO schema documenting the standardized API error envelope.
 */
export class ApiErrorResponseDto implements ApiErrorResponse {
  @ApiProperty({
    example: 400,
    description:
      'HTTP status code, repeated in the body so a logged response is self-contained.',
  })
  readonly statusCode!: number;

  @ApiProperty({
    example: 'Bad Request',
    description: 'Human-readable name of the status.',
  })
  readonly error!: string;

  @ApiProperty({
    example: 'BAD_REQUEST',
    description: 'Stable machine-readable error code.',
  })
  readonly code!: string;

  @ApiProperty({
    example: 'Request validation failed',
    description: 'Human-readable description of what went wrong.',
  })
  readonly message!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['name must be a string'],
    description: 'Per-field detail, present for validation failures.',
  })
  readonly details?: string[];

  @ApiProperty({
    example: '/api/v1/agents',
    description: 'Request path the error occurred on.',
  })
  readonly path!: string;

  @ApiProperty({
    example: '2026-10-04T12:00:00.000Z',
    description: 'ISO-8601 UTC timestamp.',
  })
  readonly timestamp!: string;
}

/**
 * Fallback code for a status this enum does not name.
 */
const UNKNOWN_CODE = 'HTTP_ERROR';

/**
 * Derives the machine-readable code from an HTTP status.
 *
 * `HttpStatus` is a numeric enum, so the reverse mapping yields the canonical
 * screaming-snake-case name (`404` -> `NOT_FOUND`). Deriving the code means
 * every endpoint gets a usable one for free; an exception that needs something
 * more specific can supply its own `code` in its response body.
 */
export function codeForStatus(status: number): string {
  const name = (HttpStatus as unknown as Record<number, string | undefined>)[
    status
  ];

  return name ?? UNKNOWN_CODE;
}

/**
 * Converts a status code into its human-readable name, e.g. `Not Found`.
 */
export function titleForStatus(status: number): string {
  const code = codeForStatus(status);

  if (code === UNKNOWN_CODE) {
    return 'Error';
  }

  return code
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
