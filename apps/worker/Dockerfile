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

RUN pnpm install --frozen-lockfile && \
    pnpm -r --filter "@nexiom/*" build && \
    pnpm --filter worker build

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

# Install production dependencies
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Copy built artifacts from builder
COPY --from=builder --chown=nodejs:nodejs /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages

USER nodejs

# Install the healthcheck script used by the HEALTHCHECK instruction below.
COPY --chown=nodejs:nodejs apps/worker/worker-healthcheck.sh /usr/local/bin/worker-healthcheck.sh
# Temporarily elevate to root to chmod; then drop back to the non-root user.
USER root
RUN chmod +x /usr/local/bin/worker-healthcheck.sh
USER nodejs

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD ["/usr/local/bin/worker-healthcheck.sh"]

CMD ["node", "apps/worker/dist/main.js"]
