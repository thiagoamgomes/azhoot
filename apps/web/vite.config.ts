import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:3333';

// Proxy apenas em desenvolvimento/preview: em produção a SPA é servida separada da API
// (ou atrás do mesmo domínio via proxy reverso — ver docs/operations.md).
const proxy = {
  '/api': { target: API, changeOrigin: false },
  '/uploads': { target: API, changeOrigin: false },
  '/socket.io': { target: API, ws: true, changeOrigin: false },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true, host: true, proxy },
  preview: { port: 4173, strictPort: true, host: true, proxy },
  build: {
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          zod: ['zod'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
