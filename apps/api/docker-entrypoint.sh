#!/bin/sh
# Entrypoint da API: aplica migrações (opcional) e inicia o servidor.
set -e
cd /app

if [ "$RUN_MIGRATIONS" = "1" ]; then
  echo "[azhoot] Aplicando migrações do banco (prisma migrate deploy)..."
  # Resolve o CLI do prisma independentemente do layout do pnpm.
  PRISMA_CLI="$(node -e "process.stdout.write(require.resolve('prisma/build/index.js',{paths:['/app/prisma','/app']}))")"
  node "$PRISMA_CLI" migrate deploy --schema /app/prisma/schema.prisma
fi

echo "[azhoot] Iniciando a API na porta ${API_PORT:-3333}..."
exec node apps/api/dist/index.js
