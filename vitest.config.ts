import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Most suites are pure logic and run in node. The ones that touch
    // localStorage declare `@vitest-environment happy-dom` at the top of the file.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/helpers/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/ui/**', 'src/render/procgen.ts'],
    },
  },
});
