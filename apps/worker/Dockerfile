# Stage 1: Build
FROM node:20-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy lockfile and workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY tsconfig.base.json ./
COPY sdk ./sdk
COPY plugins ./plugins
COPY packages ./packages
COPY engine ./engine
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile && \
    pnpm -r --filter "@soopa/*" build && \
    pnpm --filter worker build

# Dynamically extract all workspace manifests and dists (excluding plugins, as they are downloaded dynamically at runtime)
SHELL ["/bin/ash", "-eo", "pipefail", "-c"]
RUN mkdir -p /pruned && \
    cp package.json pnpm-lock.yaml pnpm-workspace.yaml /pruned/ && \
    find apps/worker sdk packages engine -name "package.json" | tar -cf - -T - | tar -xf - -C /pruned/ && \
    find apps/worker sdk packages engine -type d -name "dist" | tar -cf - -T - | tar -xf - -C /pruned/

# Stage 2: Production
FROM node:20-alpine AS runner

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy dynamically pruned manifests and entrypoints to prevent cache invalidation
COPY --from=builder --chown=nodejs:nodejs /pruned ./

# Install production dependencies
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Copy built artifacts from builder
COPY --from=builder --chown=nodejs:nodejs /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages
COPY --from=builder --chown=nodejs:nodejs /app/sdk ./sdk
COPY --from=builder --chown=nodejs:nodejs /app/engine ./engine

USER nodejs

# Install the healthcheck script used by the HEALTHCHECK instruction below.
COPY --chown=nodejs:nodejs apps/worker/worker-healthcheck.sh /usr/local/bin/worker-healthcheck.sh
# Make healthcheck script executable and ensure procps is installed; drops privileges back via --chown/USER
USER root
RUN apk add --no-cache procps && \
    chmod +x /usr/local/bin/worker-healthcheck.sh
USER nodejs

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD ["/usr/local/bin/worker-healthcheck.sh"]

CMD ["node", "apps/worker/dist/main.js"]
