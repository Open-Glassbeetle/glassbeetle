import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * Validates the free-form `modelParams` editor.
 *
 * The column holds an arbitrary provider-specific object, so the UI cannot
 * offer typed fields for it — the field is raw JSON. Blank means "clear it",
 * which is valid; anything else has to parse and has to be a plain object,
 * because the API rejects arrays and scalars with `IsObject`.
 */
export function modelParamsValidator(control: AbstractControl): ValidationErrors | null {
  const raw = (control.value as string | null)?.trim();

  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { jsonSyntax: true };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { jsonNotObject: true };
  }

  return null;
}

/** Parses an already-validated editor value into what the API expects. */
export function parseModelParams(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();

  return trimmed ? (JSON.parse(trimmed) as Record<string, unknown>) : null;
}

/** Renders stored params back into the editor, or an empty field when unset. */
export function formatModelParams(params: Record<string, unknown> | null): string {
  return params ? JSON.stringify(params, null, 2) : '';
}
