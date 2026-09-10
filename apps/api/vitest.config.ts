import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    // Resolves the path aliases declared in tsconfig.json, including the ones
    // added by `nest g library`.
    tsconfigPaths(),
    // esbuild (Vite's default TS transform) cannot emit `design:paramtypes`,
    // which Nest needs for constructor injection. SWC can.
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
  },
});
