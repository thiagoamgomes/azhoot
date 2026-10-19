#!/bin/sh
# Torna um usuário existente proprietário/master (acesso ao Painel master).
# Uso no servidor (em /opt/services/docker):  ./make-owner.sh alguem@dominio.com
set -e
EMAIL="$1"
if [ -z "$EMAIL" ]; then
  echo "Uso: ./make-owner.sh <email>"
  exit 1
fi
docker compose --env-file .env.production -f docker-compose.prod.yml \
  run --rm --entrypoint node api /app/prisma/scripts/make-owner.mjs "$EMAIL"
