import { defineConfig } from 'vitest/config';

// Server-side (api/) unit tests. Scoped to api/** so the Vite/React app build is
// untouched. Pure-function coverage to start — no network/DB; add more as the
// suite grows.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['api/**/*.test.js'],
  },
});
