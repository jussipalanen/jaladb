/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // API_PORT comes from the repository root's .env, like the API itself.
  const env = loadEnv(mode, '..', '');
  const apiPort = env.API_PORT || '3000';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      // The console calls /api/...; Vite forwards it to the API, so the
      // browser only ever talks to one origin and no CORS setup is needed.
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
