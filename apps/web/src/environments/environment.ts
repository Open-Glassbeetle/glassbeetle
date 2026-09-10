/**
 * Production / packaged-app settings.
 *
 * The packaged Tauri webview is served from `tauri://localhost`, so the API
 * base URL must be absolute — a relative `/api` would resolve against the
 * custom protocol instead of the NestJS server.
 */
export const environment = {
  production: true,
  apiBaseUrl: 'http://localhost:3000/api',
};
