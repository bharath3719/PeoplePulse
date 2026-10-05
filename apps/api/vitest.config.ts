import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./vitest.global-setup.ts'],

    // The service suites run real transactions against Postgres, and the global
    // setup migrates it first. Comfortably slower than vitest's 5s default.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
