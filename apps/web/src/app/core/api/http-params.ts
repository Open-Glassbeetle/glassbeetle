import { HttpParams } from '@angular/common/http';

/**
 * Builds `HttpParams` from a loose query object, dropping entries the API would
 * reject or that carry no meaning.
 *
 * `undefined`, `null` and empty strings are omitted rather than sent as empty
 * parameters: the API's `ValidationPipe` treats a present-but-empty filter as a
 * filter, so sending `?name=` would search for the empty string instead of not
 * filtering at all.
 *
 * The literal string `'null'` is preserved — the agents endpoint uses it to
 * select rows whose `modelId` / `systemPromptId` is NULL.
 */
export function toHttpParams(query: Record<string, unknown>): HttpParams {
  let params = new HttpParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    params = params.set(key, String(value));
  }

  return params;
}
