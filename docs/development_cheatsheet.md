# Development Cheatsheet 📝

## 1. Credentials (Local Environment)

| Service | Host | Port | User | Password | Database |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Postgres (Docker)** | `localhost` | `5432` | `admin` | `password123` | `nexiom_master` |
| **Backend API** | `localhost` | `3000` | - | - | - |
| **Frontend** | `localhost` | `5173` | - | - | - |

## 2. Environment Variables (.env)

> [!CAUTION]
> **DO NOT COMMIT THIS FILE TO PUBLIC REPOS**
> This file contains real credentials for convenience.

```env
MAIL_MOCK=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=pramod.narayana@gmail.com
SMTP_PASS=cjfj jklo ravy wazf
SMTP_FROM="Nexiom <pramod.narayana@gmail.com>"
```

## 2. Drizzle ORM (Database)

| Action | Command | Description |
| :--- | :--- | :--- |
| **Open Studio (UI)** | `pnpm --filter api db:studio` | Opens **https://local.drizzle.studio** to view/edit data. |
| **Push Schema** | `pnpm --filter api db:push` | Applies schema changes from `schema.ts` to DB. |
| **Seed Roles** | `pnpm --filter api db:seed` | Populates default roles (`admin`, `editor`, `viewer`, `user`). |

## 3. Default Roles

*   `admin` - Full Access
*   `editor` - Edit Access
*   `viewer` - Read Only
*   `user` - Standard User
