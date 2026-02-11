# Database Management Tool

## Overview

Enterprise-grade TypeScript database management tool using Drizzle Kit, replacing all shell scripts with a unified CLI.

## Commands

### Fresh Install

Complete database rebuild - drops everything, runs migrations, seeds data:

```bash
pnpm --filter api db:fresh
```

### Reset

Clears data but preserves schema - truncates tables, reseeds data:

```bash
pnpm --filter api db:reset
```

### Individual Operations

```bash
# Drop all schemas (destructive)
pnpm --filter api db:drop

# Run pending migrations only
pnpm --filter api db:migrate

# Seed RBAC and default data only
pnpm --filter api db:seed
```

## How It Works

**DatabaseManager** (`apps/api/src/db/database-manager.ts`):

- TypeScript class wrapping database operations
- Uses Docker exec for SQL commands (avoids tsx decorator issues)
- Orchestrates Drizzle Kit for migrations
- Environment safety checks (only dev/test/local)

**CLI Interface** (`apps/api/src/db/db-cli.ts`):

- Simple command-line wrapper
- Loads environment variables
- Error handling with detailed messages

## Safety

All destructive operations (`drop`, `fresh`, `reset`) check `NODE_ENV`:

- ✅ Allowed: `development`, `test`, `local`
- ❌ Blocked: `production`, `staging`, or unset

## Migration Workflow

1. **Update schema** in code (`src/db/schema.ts` or `@nexiom/identity/schema.ts`)
2. **Generate migration**: `pnpm --filter api db:generate`
3. **Review** generated SQL in `drizzle/*.sql`
4. **Apply migration**: `pnpm --filter api db:migrate`
5. **Commit** migration files to git

## Development Workflow

```bash
# Start fresh (first time or after major changes)
pnpm --filter api db:fresh

# Reset data (during development/testing)
pnpm --filter api db:reset

# After pulling new migrations
pnpm --filter api db:migrate
```

## Removed

- ~~`scripts/reset-db-docker.sh`~~ - Replaced by `db:fresh`/`db:reset`
- ~~`scripts/reset-db.sh`~~ - Replaced by `db:fresh`/`db:reset`
- ~~Manual table creation~~ - Now handled by proper migrations
