# Nexiom Platform (Monorepo)

This project is a **Monorepo** managed by [Turborepo](https://turbo.build/).

## Project Structure

*   **`apps/web`**: React + Vite (Frontend) - Port 5173
*   **`apps/api`**: NestJS (Backend) - Port 3000

## Getting Started

### 1. Install Dependencies (Root)
```bash
pnpm install
```

### 2. Start Development (Everything)
This will launch both `frontend` and `backend` in parallel.
```bash
pnpm dev
```

## Workflows

*   **Add Package**: `pnpm add <pkg> --filter <workspace>`
    *   Ex: `pnpm add axios --filter web`
    *   Ex: `pnpm add @nestjs/config --filter api`
