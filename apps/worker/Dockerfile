# syntax=docker/dockerfile:1.7
FROM node:24.15.0-bookworm-slim AS build

WORKDIR /workspace
RUN npm install --global pnpm@9.15.0
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm build \
    && pnpm --filter @ai-crm/worker deploy --prod /opt/application \
    && node scripts/deploy/sanitize-application-artifact.mjs /opt/application \
    && test -f /opt/application/dist/main.js \
    && test -f /opt/application/dist/worker-healthcheck.mjs \
    && test ! -e /opt/application/src \
    && test ! -e /opt/application/coverage \
    && test ! -e /opt/application/test-fixtures \
    && mkdir -p /opt/application/packages/database \
    && cp -R packages/database/migrations /opt/application/packages/database/migrations \
    && for migration_dir in packages/platform-modules/*/migrations; do \
         module="$(basename "$(dirname "$migration_dir")")"; \
         mkdir -p "/opt/application/packages/platform-modules/$module"; \
         cp -R "$migration_dir" "/opt/application/packages/platform-modules/$module/migrations"; \
       done \
    && node scripts/deploy/generate-migration-manifest.mjs /opt/application /opt/application/ai-crm-migrations.manifest.json

FROM node:24.15.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /opt/application/ ./
USER node
CMD ["node", "dist/main.js"]
