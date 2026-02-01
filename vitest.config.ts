import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Don't fail if no test files are found
    passWithNoTests: true,
    // Global test settings
    globals: true,
    environment: 'node',
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
