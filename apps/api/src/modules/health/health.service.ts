import { constants as fsConstants, promises as fs } from 'node:fs';
import { Injectable, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { FileStorageService } from '../../file-storage/file-storage.service.js';

/**
 * Overall verdict: `ok` only when every component check is `up`.
 */
export type HealthState = 'ok' | 'degraded';
/**
 * State of one dependency.
 *
 * `not_configured` is distinct from `down` on purpose: it means the provider
 * was not injected at all, which happens in tests and in a partial boot, and
 * it must not be read as a failure of a dependency that is present.
 */
export type ComponentStatus = 'up' | 'down' | 'not_configured';

/**
 * Result of the SQLite connectivity check.
 */
export interface DatabaseHealth {
  status: ComponentStatus;
  error?: string;
}

/**
 * Result of the storage-root check.
 */
export interface StorageHealth {
  status: ComponentStatus;
  error?: string;
}

/**
 * Per-dependency results behind the overall {@link HealthStatus.status}.
 */
export interface HealthChecks {
  database: DatabaseHealth;
  storage: StorageHealth;
}

/**
 * The health report returned by `GET /health`.
 *
 * Shaped by hand rather than as a DTO class, and described inline in the
 * controller's `@ApiOkResponse`, because nothing validates it as input.
 */
export interface HealthStatus {
  /**
   * `ok` when every check passed, `degraded` otherwise. Mirrored by the HTTP
   * status code (200 or 503).
   */
  status: HealthState;
  /**
   * Fixed service identifier, so a probe pointed at the wrong port can tell.
   */
  service: string;
  /**
   * Whole seconds since this service instance was constructed — not process
   * uptime, which a restarted Nest application would not reset.
   */
  uptimeSeconds: number;
  /**
   * ISO-8601 UTC instant the report was produced.
   */
  timestamp: string;
  checks: HealthChecks;
}

/**
 * Reports whether the API's two local dependencies are usable.
 *
 * "Healthy" here means the database answers and the storage root is a
 * writable directory — the two things every write endpoint needs. Checks run
 * on every request rather than on a timer, since a cached verdict is exactly
 * what a readiness probe must not return.
 *
 * Both dependencies are `@Optional()` so the endpoint still answers when one
 * was not wired, reporting `not_configured` instead of failing.
 */
@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional() private readonly fileStorageService?: FileStorageService,
  ) {}

  /**
   * Runs every check and assembles the report.
   *
   * Does not throw: a failing dependency is data in the response, not an
   * exception, so the caller always receives a readable verdict.
   */
  async getHealth(): Promise<HealthStatus> {
    const dbHealth = this.checkDatabase();
    const storageHealth = await this.checkStorage();
    const isHealthy = dbHealth.status === 'up' && storageHealth.status === 'up';

    return {
      status: isHealthy ? 'ok' : 'degraded',
      service: 'glassbeetle-api',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      checks: {
        database: dbHealth,
        storage: storageHealth,
      },
    };
  }

  /**
   * Probes the database with `SELECT 1`.
   *
   * A trivial query rather than a pragma or a table read, so the check proves
   * the connection is open and answering without depending on the schema.
   *
   * The error message is passed through, since a SQLite error names the file at
   * most and the alternative — reporting `down` with no reason — is what makes
   * a health endpoint useless when it matters.
   */
  private checkDatabase(): DatabaseHealth {
    if (
      !this.databaseService ||
      typeof this.databaseService.get !== 'function'
    ) {
      return { status: 'not_configured' };
    }

    try {
      this.databaseService.get('SELECT 1');
      return { status: 'up' };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Checks that the storage root is an existing directory this process may
   * write to.
   *
   * `/health` is polled, so this is a `stat` and an `access(W_OK | X_OK)` on
   * every request: no write probe, nothing created, and no cache that could
   * keep reporting `up` after the volume has gone away.
   *
   * What it does not catch:
   * - a full disk or an exhausted quota, which only an actual write reveals;
   * - filesystems where `access` disagrees with a real write, such as network
   *   shares that enforce permissions on the server, or Windows, where
   *   `W_OK` only reflects the read-only attribute;
   * - bucket directories under the root that are missing or unwritable.
   *
   * The error names the failure but not the path, so the response does not
   * reveal the local filesystem layout.
   */
  private async checkStorage(): Promise<StorageHealth> {
    if (
      !this.fileStorageService ||
      typeof this.fileStorageService.storageRoot !== 'string'
    ) {
      return { status: 'not_configured' };
    }

    const root = this.fileStorageService.storageRoot;

    try {
      const stats = await fs.stat(root);
      if (!stats.isDirectory()) {
        return { status: 'down', error: 'Storage root is not a directory' };
      }
      await fs.access(root, fsConstants.W_OK | fsConstants.X_OK);
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: describeStorageError(error) };
    }
  }
}

/**
 * Turns a filesystem error into a message without the absolute path that
 * Node includes in `error.message`.
 */
function describeStorageError(error: unknown): string {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined;

  switch (code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return `Storage root does not exist (${code})`;
    case 'EACCES':
    case 'EPERM':
      return `Storage root is not writable (${code})`;
    case 'EROFS':
      return `Storage root is on a read-only file system (${code})`;
    default:
      return code
        ? `Storage root check failed (${code})`
        : 'Storage root check failed';
  }
}
