import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';

/**
 * Provides the single {@link DatabaseService} connection.
 *
 * `@Global()` because almost every feature module needs it and threading an
 * import through all of them adds nothing. One connection for the whole
 * process is deliberate: `better-sqlite3` is synchronous and SQLite allows a
 * single writer, so a pool would buy no concurrency and would multiply the
 * chances of `SQLITE_BUSY`.
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
