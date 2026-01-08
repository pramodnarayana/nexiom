FROM node:20-alpine

# Enable pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy root workspace configs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy app source
COPY apps/api ./apps/api
# If you had shared packages: COPY packages ./packages 

# Install dependencies (frozen-lockfile for speed/safety)
RUN pnpm install --frozen-lockfile

# Build API
RUN pnpm --filter api build

# Expose API port (Implicit via docker-compose)
# EXPOSE 3000

# Start Production Server (Single Stage)
CMD ["node", "apps/api/dist/src/main"]
