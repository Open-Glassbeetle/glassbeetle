import { Injectable, effect, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'glassbeetle.theme';

/**
 * Light/dark preference, applied as `data-theme` on `<html>`.
 *
 * The theme is a single `mat.theme()` built with `theme-type: color-scheme`, so
 * switching schemes only means flipping the CSS `color-scheme` property — no
 * second stylesheet is loaded and no component restyles itself.
 *
 * Glassbeetle has shipped dark, so dark remains the default when the user has
 * expressed no preference and the OS reports none.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _mode = signal<ThemeMode>(readInitialMode());

  readonly mode = this._mode.asReadonly();

  constructor() {
    effect(() => {
      const mode = this._mode();
      document.documentElement.dataset['theme'] = mode;

      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        // Private browsing or blocked site data: the preference simply does not
        // survive a reload, which is not worth failing the app over.
      }
    });
  }

  toggle(): void {
    this._mode.update((mode) => (mode === 'dark' ? 'light' : 'dark'));
  }

  set(mode: ThemeMode): void {
    this._mode.set(mode);
  }
}

function readInitialMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // Fall through to the OS preference.
  }

  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
