import { environment } from '../../environments/environment';

/**
 * The two links that open in the system browser, from the workspace panel and
 * from the native menu's Help items alike.
 *
 * The docs URL comes from the environment, beside `apiBaseUrl`, so it follows
 * the port this build talks to instead of a second copy of it.
 */
export const API_DOCS_URL = environment.apiDocsUrl;
export const REPOSITORY_URL = 'https://github.com/Open-Glassbeetle/glassbeetle';
