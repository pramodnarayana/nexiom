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
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

ENV NODE_ENV=production
ENV PORT=4000

# We MUST copy packages/pieces because main.js scans for openapi.json dynamically!
COPY packages/pieces ./packages/pieces

# Copy the completely isolated, pre-installed deployment bundle from builder
COPY --from=builder /app/deploy ./apps/mock-gateway

WORKDIR /app/apps/mock-gateway
EXPOSE 4000

CMD ["node", "dist/main.js"]
