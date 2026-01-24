# Command History Log

This document tracks the terminal commands executed during the setup of the Nexiom project.

## 1. Documentation Migration
```bash
cp -r /Users/apple/fluxnex/docs /Users/apple/engineering/nexiom/docs
```

## 2. Authentication Setup
```bash
pnpm remove @zitadel/react
pnpm install react-oidc-context oidc-client-ts
```

## 3. Git Repository Setup
```bash
git init
echo ".env" >> .gitignore
git add .
git commit -m "Initial commit..."
git remote add origin https://github.com/pramodnarayana/nexiom.git
git push -u origin master
```

## 4. Frontend Infrastructure (Routing)
```bash
pnpm install react-router-dom
mkdir -p src/pages src/components
```

## 5. Restructuring (Monorepo Prep)
```bash
# Moved React app to frontend/
mkdir frontend
mv src public index.html vite.config.ts tsconfig*.json eslint.config.js package.json pnpm-lock.yaml .env node_modules frontend/

# Initialized Express Backend (DEPRECATED/REMOVED)
mkdir backend && cd backend && pnpm init
pnpm add express cors dotenv zod
pnpm add -D typescript @types/node @types/express @types/cors ts-node nodemon
# ... We later deleted this to switch to NestJS
```

## 6. Turborepo & NestJS Migration (Current)
```bash
# Clean up Express
rm -rf backend

# Setup Workspace
touch pnpm-workspace.yaml
pnpm add -D turbo -w

## 7. Authentication Pivot (Zitadel -> Lucia)
```bash
# 1. Remove Zitadel
pnpm --filter api remove @zitadel/node
rm -rf apps/api/src/zitadel

# 2. Install Drizzle & Lucia
pnpm --filter api add drizzle-orm pg lucia @lucia-auth/adapter-drizzle oslo
pnpm --filter api add -D drizzle-kit @types/pg

# 3. Setup Database (Docker)
docker-compose up -d
pnpm --filter api exec drizzle-kit push

# 4. Install Dev Dependencies
pnpm --filter api add -D @types/pg

# 5. Run Drizzle Studio (UI)
pnpm --filter api db:studio
```
