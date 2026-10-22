import { Injectable } from '@nestjs/common';

/**
 * Backs the root banner endpoint.
 *
 * Deliberately trivial: it holds the service name so `AppController` has a
 * provider to delegate to and the root route follows the same
 * controller-to-service shape as every other route.
 */
@Injectable()
export class AppService {
  /**
   * Returns the service name reported by the root endpoint.
   */
  getHello(): string {
    return 'Glassbeetle API';
  }
}
