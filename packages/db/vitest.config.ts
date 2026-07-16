import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],

    // The isolation suite migrates a real database in beforeAll — DDL plus the
    // RLS policies. That is comfortably slower than vitest's 5s default.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
