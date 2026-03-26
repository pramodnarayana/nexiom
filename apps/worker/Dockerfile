# Stage 1: Build
FROM node:20-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy lockfile and workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
# Copy all packages (since worker depends on engine, database, queue, pieces, etc.)
COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile
RUN pnpm -r --filter "@nexiom/*" build
RUN pnpm --filter worker build

# Stage 2: Production
FROM node:20-alpine AS runner

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages ./packages

# Build packages before installing prod deps? Wait, if we copy built packages from builder it's better.
# For simplicity in this monorepo without strict pruning, we just install prod deps.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=builder --chown=nodejs:nodejs /app/apps/worker/dist ./apps/worker/dist
# Also copy built packages/engine/dist, etc., but since TS reads from dist anyway, `pnpm install` in monorepo symlinks them. Wait, if we don't compile packages, worker won't run.
# Actually, since engine/dist is not copied to runner, it fails. I'll copy entire packages from builder to runner to be safe.
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages

USER nodejs

CMD ["node", "apps/worker/dist/main.js"]
