# syntax=docker/dockerfile:1
# AZhoot API — build (tsup) + runtime (node). Prisma client gerado no build.

FROM node:22.23.4-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
# Ferramentas para compilar dependências nativas (argon2, sharp).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @azhoot/db generate
RUN pnpm --filter @azhoot/api build

FROM node:22.23.4-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Copia o monorepo já instalado e compilado (inclui prisma client, schema e node_modules).
COPY --from=build /app /app
RUN mkdir -p /app/uploads
EXPOSE 3333
ENTRYPOINT ["sh", "/app/apps/api/docker-entrypoint.sh"]
