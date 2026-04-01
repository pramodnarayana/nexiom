FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

# Need lockfile and workspace definitions
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mock-gateway ./apps/mock-gateway

RUN pnpm install --filter mock-gateway...

RUN pnpm --filter mock-gateway build

# This creates an isolated bundle of mock-gateway with only its production dependencies
RUN pnpm deploy --legacy --filter mock-gateway --prod /app/deploy

FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -S mockgateway && adduser -S mockgateway -G mockgateway

ENV NODE_ENV=production
ENV PORT=4000

# We MUST copy packages/pieces because main.js scans for openapi.json dynamically!
COPY --chown=mockgateway:mockgateway packages/pieces ./packages/pieces

# Copy the completely isolated, pre-installed deployment bundle from builder
COPY --chown=mockgateway:mockgateway --from=builder /app/deploy ./apps/mock-gateway

RUN chown -R mockgateway:mockgateway /app

WORKDIR /app/apps/mock-gateway
USER mockgateway

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "dist/main.js"]
