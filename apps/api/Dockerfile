# Stage 1: Build
FROM node:20-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY tsconfig.base.json ./
COPY sdk ./sdk
COPY plugins ./plugins
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile
RUN pnpm --filter api build

# Stage 2: Production
FROM node:20-alpine AS runner

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy only production dependencies - package manifests for workspace resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/

# Copy workspace package manifests only (not full source)
COPY sdk/framework/package.json ./sdk/framework/
COPY sdk/registry/package.json ./sdk/registry/
COPY plugins/domain/tms/package.json ./plugins/domain/tms/
COPY plugins/quickbooks/core/package.json ./plugins/quickbooks/core/
COPY plugins/salesforce/core/package.json ./plugins/salesforce/core/
COPY plugins/salesforce/revenova-piece/package.json ./plugins/salesforce/revenova-piece/
COPY plugins/salesforce/revenova-shard/package.json ./plugins/salesforce/revenova-shard/
COPY plugins/shared/mapping/package.json ./plugins/shared/mapping/
COPY packages/ai/package.json ./packages/ai/
COPY packages/auth/package.json ./packages/auth/
COPY packages/cache/package.json ./packages/cache/
COPY packages/credentials/package.json ./packages/credentials/
COPY packages/database/package.json ./packages/database/
COPY packages/dbmanager/package.json ./packages/dbmanager/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/identity/package.json ./packages/identity/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/metadata-engine/package.json ./packages/metadata-engine/
COPY packages/observability/package.json ./packages/observability/
COPY packages/pipeline/package.json ./packages/pipeline/
COPY packages/queue/package.json ./packages/queue/
COPY packages/security/package.json ./packages/security/
COPY packages/transformer/package.json ./packages/transformer/
COPY packages/utils/package.json ./packages/utils/

# Ignore scripts to skip 'husky install' (prepare) which fails in prod
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Copy built artifacts
COPY --from=builder --chown=nodejs:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages

USER nodejs

# Expose API port (Implicit via docker-compose)
# EXPOSE 3000

CMD ["node", "apps/api/dist/main"]
