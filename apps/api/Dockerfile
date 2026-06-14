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

# Dynamically extract all workspace manifests and dists (excluding plugins, as they are downloaded dynamically at runtime)
RUN mkdir -p /pruned && \
    cp package.json pnpm-lock.yaml pnpm-workspace.yaml /pruned/ && \
    find apps/api sdk packages -name "package.json" | tar -cf - -T - | tar -xf - -C /pruned/ && \
    find apps/api sdk packages -type d -name "dist" | tar -cf - -T - | tar -xf - -C /pruned/

# Stage 2: Production
FROM node:20-alpine AS runner

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy dynamically pruned manifests and entrypoints to prevent cache invalidation
COPY --from=builder --chown=nodejs:nodejs /pruned ./

# Install production dependencies
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Copy built artifacts
COPY --from=builder --chown=nodejs:nodejs /app/apps/api ./apps/api
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages
COPY --from=builder --chown=nodejs:nodejs /app/sdk ./sdk

USER nodejs

# Expose API port (Implicit via docker-compose)
# EXPOSE 3000

CMD ["node", "apps/api/dist/main"]
