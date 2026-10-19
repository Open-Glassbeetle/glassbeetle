import { constants as fsConstants, promises as fs } from 'node:fs';
import { Injectable, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { FileStorageService } from '../../file-storage/file-storage.service.js';

export type HealthState = 'ok' | 'degraded';
export type ComponentStatus = 'up' | 'down' | 'not_configured';

export interface DatabaseHealth {
  status: ComponentStatus;
  error?: string;
}

export interface StorageHealth {
  status: ComponentStatus;
  error?: string;
}

export interface HealthChecks {
  database: DatabaseHealth;
  storage: StorageHealth;
}

export interface HealthStatus {
  status: HealthState;
  service: string;
  uptimeSeconds: number;
  timestamp: string;
  checks: HealthChecks;
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional() private readonly fileStorageService?: FileStorageService,
  ) {}

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
