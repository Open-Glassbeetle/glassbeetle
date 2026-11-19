/**
 * Production / packaged-app settings.
 *
 * The packaged Tauri webview is served from `tauri://localhost`, so the API
 * base URL must be absolute — a relative `/api` would resolve against the
 * custom protocol instead of the NestJS server.
 */
export const environment = {
  production: true,
  apiBaseUrl: 'http://localhost:3000/api/v1',
  // The API's interactive documentation. Kept beside apiBaseUrl so a change of
  // port is made once for both, rather than derived from the shape of the
  // other string.
  apiDocsUrl: 'http://localhost:3000/api/docs',
};
