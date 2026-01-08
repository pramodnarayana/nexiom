# Stage 1: Build
FROM node:20-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
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

# Copy only production dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
# Ignore scripts to skip 'husky install' (prepare) which fails in prod
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Copy built artifacts
COPY --from=builder --chown=nodejs:nodejs /app/apps/api/dist ./apps/api/dist

USER nodejs

# Expose API port (Implicit via docker-compose)
# EXPOSE 3000

CMD ["node", "apps/api/dist/src/main"]
