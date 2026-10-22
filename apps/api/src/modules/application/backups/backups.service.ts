import { Injectable } from '@nestjs/common';

/**
 * Will create, list and restore backup archives.
 *
 * Not implemented. One decision is already settled and documented in
 * `EncryptionService`: the master key lives outside the database, so an
 * archive that omits it cannot restore usable provider credentials, and one
 * that includes it defeats the point of keeping them apart.
 */
@Injectable()
export class BackupsService {}
