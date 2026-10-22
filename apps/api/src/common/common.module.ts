import { Module } from '@nestjs/common';

/**
 * Placeholder module for the cross-cutting helpers under `src/common/`.
 *
 * Those helpers — pagination, persistence conversion, logging, the error
 * envelope — are plain functions and classes imported directly where they are
 * needed, so nothing is registered here. The module is imported by `AppModule`
 * to keep a place for a future shared provider that does need injection, such
 * as a request-scoped context provider.
 */
@Module({})
export class CommonModule {}
