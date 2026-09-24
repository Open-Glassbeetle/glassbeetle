import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppConfigService } from '../config/app-config.service.js';
import { runMigrations } from './schema-migrations.js';

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * SQLite database service providing connection lifecycle management,
 * schema migrations, and a thin query interface for NestJS feature modules.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private dbInstance?: Database.Database;

  constructor(
    @Optional() private readonly appConfigService?: AppConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.dbInstance) {
      const dbPath = this.appConfigService?.databasePath ?? ':memory:';
      this.connect(dbPath);
    }
  }

  onModuleDestroy(): void {
    this.close();
  }

  /**
   * Opens the SQLite connection, enables foreign keys and WAL mode,
   * and runs initial schema migrations.
   */
  public connect(dbPath: string = ':memory:'): void {
    if (this.dbInstance) {
      return;
    }

    if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
      const dir = dirname(dbPath);
      mkdirSync(dir, { recursive: true });
    }

    this.dbInstance = new Database(dbPath);
    this.dbInstance.pragma('foreign_keys = ON');
    this.dbInstance.pragma('journal_mode = WAL');

    runMigrations(this.dbInstance);
  }

  /**
   * Cleanly closes the database connection.
   */
  public close(): void {
    if (this.dbInstance?.open) {
      this.dbInstance.close();
    }
    this.dbInstance = undefined;
  }

  /**
   * Direct access to the underlying `better-sqlite3` instance.
   */
  public get db(): Database.Database {
    if (!this.dbInstance) {
      throw new Error(
        'Database is not initialized. Call connect() or let NestJS module initialization run.',
      );
    }
    return this.dbInstance;
  }

  /**
   * Executes raw DDL or multi-statement SQL scripts.
   */
  public exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Retrieves a single row matching the SQL query.
   */
  public get<T = unknown>(
    sql: string,
    params?: any[] | Record<string, any>,
  ): T | undefined {
    const stmt = this.db.prepare(sql);
    if (params === undefined) {
      return stmt.get() as T | undefined;
    }
    return (
      Array.isArray(params) ? stmt.get(...params) : stmt.get(params)
    ) as T | undefined;
  }

  /**
   * Retrieves all rows matching the SQL query.
   */
  public all<T = unknown>(
    sql: string,
    params?: any[] | Record<string, any>,
  ): T[] {
    const stmt = this.db.prepare(sql);
    if (params === undefined) {
      return stmt.all() as T[];
    }
    return (
      Array.isArray(params) ? stmt.all(...params) : stmt.all(params)
    ) as T[];
  }

  /**
   * Executes a state-modifying query (INSERT, UPDATE, DELETE).
   */
  public run(
    sql: string,
    params?: any[] | Record<string, any>,
  ): RunResult {
    const stmt = this.db.prepare(sql);
    const result =
      params === undefined
        ? stmt.run()
        : Array.isArray(params)
          ? stmt.run(...params)
          : stmt.run(params);

    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  /**
   * Executes a callback within a SQLite transaction.
   * If the callback throws an error, the transaction is automatically rolled back.
   */
  public transaction<T>(fn: () => T): T {
    const trx = this.db.transaction(fn);
    return trx();
  }
}
