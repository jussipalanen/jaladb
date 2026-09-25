import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['database/tests/**/*.test.ts'],
    globalSetup: ['database/tests/setup/global-setup.ts'],
    // All test files share one PostgreSQL test database. Running files one at a
    // time keeps table-level locks (e.g. TRUNCATE in the seed tests) from
    // interfering with other files.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
