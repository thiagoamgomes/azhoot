import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Pacotes do workspace são TypeScript-fonte: embutidos no bundle.
  noExternal: [/^@azhoot\//],
  external: ['@prisma/client', '@prisma/adapter-pg', 'argon2', 'sharp'],
});
