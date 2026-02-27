# Shared Auth Architecture (`@nexiom/auth`)

## Overview

As the Nexiom monorepo expands to include multiple applications (e.g., the main API, background queue processors, WebSocket servers, or internal CLI tools), authentication logic must be universally accessible, strictly decoupled, and highly performant.

Currently, core authentication components—such as `AuthGuard`, `AuthService`, and session validation logic—reside within the `identity` feature module. This creates tight coupling, forcing other domains (like `connections`) to import files across feature boundaries using fragile relative paths (`../../identity/auth/auth.guard`).

To establish an **Enterprise-Grade** standard, we are extracting all cross-cutting authentication concerns into a dedicated, standalone monorepo package: `@nexiom/auth`.

## Why a Dedicated Package?

While moving Auth to a shared directory within the API app (e.g., `apps/api/src/common/auth`) improves organization, a dedicated `@nexiom/auth` package offers strict, physical guarantees:

1. **Strict Dependency Boundaries:** The TypeScript compiler and package manager prevent circular dependencies. The Auth layer cannot accidentally import domain-specific logic from the main application; it remains pure and isolated.
2. **Universal Portability:** Any future microservice or application within the monorepo can instantly secure its endpoints by running `pnpm add @nexiom/auth` and importing the shared `AuthModule`, ensuring identical security standards system-wide.
3. **Optimized Build Caching:** In a Turborepo environment, changes to the main API will not trigger a rebuild or re-linting of the Auth package. The `@nexiom/auth` package enjoys a 100% cache hit rate unless its specific logic is modified, significantly speeding up CI/CD pipelines.

## Architecture Implementation

### 1. The `@nexiom/auth` Package Structure

A new package will be scaffolded at `packages/auth` with its own `package.json`, `tsconfig.json`, and standardized exports.

It will encapsulate:

- **`AuthGuard`:** The core NestJS guard responsible for intercepting requests and validating sessions.
- **`AuthService`:** Abstracted logic dealing strictly with session validation, extraction, and enrichment.
- **`PermissionsGuard` & `PlatformGuard`:** Role-based access control (RBAC) and context validation guards.
- **Context Decorators:** Standardized parameter decorators for controllers, such as `@CurrentUser()` and `@CurrentSession()`, ensuring controllers across any domain extract validated state consistently.

### 2. Integration with Applications

Applications (like `apps/api`) will declare `@nexiom/auth` as a workspace dependency.

Controllers across *any* domain will simply import the guard and decorators from the core namespace:

```typescript
import { AuthGuard, CurrentUser } from '@nexiom/auth';

@UseGuards(AuthGuard)
@Get('/connections')
async getConnections(@CurrentUser() user: User) { 
  // ... 
}
```

### 3. Decoupling from Feature Modules

By moving this logic, feature modules are no longer concerned with *how* a user is authenticated. They simply apply the `@UseGuards(AuthGuard)` decorator, asserting that the globally shared core framework has successfully attached a validated user and session to the execution context.
