FROM node:20-alpine AS builder

# Enable pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy root configs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy app source
COPY apps/web ./apps/web
# COPY packages ./packages

# Install
RUN pnpm install --frozen-lockfile

# Build Web (Vite)
# Force Relative Path for Docker (Use Nginx Proxy)
ENV VITE_API_URL="/api"
RUN pnpm --filter web build

# --- Runner Stage (Nginx) ---
FROM nginx:alpine AS runner

# Copy build output to Nginx html dir
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy custom nginx config
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
