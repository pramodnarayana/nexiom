# Directory Structure Analysis & Recommendation

**Status:** Analysis Complete  
**Date:** 2026-01-23  
**Recommendation:** Refactor NOW (before Task 01)

---

## The Gap: Current vs. Proposed

### 1. Proposed Structure (`docs/old/nexiom_tech_stack_and_repo_plan.md`)

The plan calls for a **Modular Monorepo** (Turborepo style) where core logic lives in shared packages:

```
/
├── /apps                  # Deployable apps
│   ├── /web               # Frontend (Refine)
│   └── /api               # Backend API (NestJS)
│
├── /packages              # Shared Logic (THE MISSING PIECE)
│   ├── /identity          # Auth + Users + Tenants
│   ├── /billing           # Billing logic
│   ├── /notifications     # Notification logic
│   └── /engine            # Integration core
│
└── /integrations          # Business logic plugins
```

**Why this is good:**

- ✅ **Separation of Concerns:** Core logic isn't coupled to the API server
- ✅ **Reusability:** Functions can be used by API, Workers,CLI, etc.
- ✅ **Open Source Ready:** Packages can be published to npm easily
- ✅ **Maintenance:** Clear boundaries between modules

### 2. Current Reality (What exists on disk)

We currently have a **Simple Monorepo** where everything is inside `apps/api/src/modules`:

```
/
├── /apps
│   ├── /web
│   └── /api
│       └── /src
│           └── /modules
│               ├── /auth      # Logic trapped in API
│               ├── /users     # Logic trapped in API
│               ├── /tenants   # Logic trapped in API
│               └── ...
│
└── /packages              # DOES NOT EXIST
```

**Why this is a problem:**

- ❌ **Tightly Coupled:** Service logic is mixed with HTTP controllers
- ❌ **Hard to Extract:** Moving to open source later will be a massive "rip and replace"
- ❌ **Hard to Test:** Integration tests rely on the full HTTP stack

---

## Recommendation: Refactor BEFORE Moving Forward

**Do NOT implement Task 01 (Rate Limiting) on the current structure.**

If we add rate limiting, security, and more features to the current `apps/api` folder, we are digging a deeper hole. We should align the directory structure with the **Open Source Package Architecture** immediately.

### Why Refactor Now?

1. **Clean Slate:** The codebase is still relatively small. Refactoring now takes days; refactoring later takes weeks/months.
2. **Security Integration:** The new security features (Task 01) should ideally live in the infrastructure/framework layer or packages, not just hardcoded into one API app.
3. **Open Source Goal:** You explicitly stated you want `@nexiom/identity` as a standalone package. We cannot achieve that if the code lives in `apps/api/src/modules/identity`.

---

## The Refactor Plan (Pre-requisite to Task 01)

### Phase 1: Create Monorepo Structure

1. Initialize **Turborepo** (if not already fully configured).
2. Create `packages/` directory.
3. Set up `pnpm-workspace.yaml`.

### Phase 2: Extract `@nexiom/identity`

Move existing logic from `apps/api` to `packages/identity`:

**From:**
`apps/api/src/modules/auth/*`
`apps/api/src/modules/users/*`
`apps/api/src/modules/tenants/*`

**To:**
`packages/identity/src/auth/*`
`packages/identity/src/users/*`
`packages/identity/src/tenants/*`

### Phase 3: Consume Package in API

Update `apps/api` to import from the package:

```typescript
// apps/api/src/app.module.ts
import { IdentityModule } from '@nexiom/identity';

@Module({
  imports: [IdentityModule.forRoot({...})]
})
export class AppModule {}
```

---

## Conclusion

**Yes, I agree with the proposed directory structure.** It is excellent for maintainability and aligns perfectly with your vision of "SaaS-in-a-Box" open source packages.

**Yes, we should refactor NOW.** Do not build new enterprise features on the old structure.

**Next Step:**
I recommend changing the first task from "Implement Rate Limiting" to **"Refactor Directory Structure & Extract Identity Package"**.
