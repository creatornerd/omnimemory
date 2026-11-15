/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server + tests. The production extension build lives in scripts/build.mjs
// because the popup/dashboard, service worker and content script each need a
// different output format.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5183, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
});
