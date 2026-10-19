import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    // Testes de integração compartilham PostgreSQL/Redis reais: execução sequencial.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
