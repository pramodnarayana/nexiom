# Identity Module Architecture: The "Guardianship" Kernel

**Status:** RFC (Request for Comments)
**Author:** Staff Architect
**Version:** 2.0 (Aligns with Nexiom Master Architecture)

---

## 1. Architectural Context (C4 Model)

The **Identity Module** (`@nexiom/identity`) is the "Security Kernel" of the Nexiom Platform. It is NOT just a user table; it is the **Authority** for:

1. **Authentication:** Who are you? (Users/Machines)
2. **Multitenancy:** Which data silo do you own? (Tenant Resolution)
3. **Authorization:** What can you click? (CBAC: Capability-Based Access Control)
4. **Credental Management:** How do we talk to external apps? (Layer 5 Support)

### 1.1 System Context Diagram (Level 1)

```mermaid
C4Context
    title System Context: Identity Module
    
    Person(user, "User", "System Admin or Tenant Member")
    System_Ext(auth_provider, "Auth Provider", "BetterAuth / Clerk / Supabase")
    
    System_Boundary(nexiom, "Nexiom Platform") {
        System(api, "API Monolith", "NestJS Backend")
        System(identity, "Identity Kernel", "@nexiom/identity Package")
        System(db, "Database", "Postgres (Public & Tenant Schemas)")
    }

    Rel(user, api, "Uses", "HTTPS/JSON")
    Rel(api, identity, "Delegates Auth To", "Interface Calls")
    Rel(identity, auth_provider, "Verifies Tokens With", "HTTP/SDK")
    Rel(identity, db, "Reads/Writes User Data", "SQL/ORM")
```

### 1.2 Container Diagram (Level 2)

Shows how the Identity Package is embedded within the Monolith but logically isolated.

```mermaid
C4Container
    title Container Diagram: Identity Package Integration

    Container_Boundary(apps, "Applications") {
        Container(api_layer, "API Layer", "NestJS Controllers", "Handles HTTP, Validation, Routing")
    }

    Container_Boundary(libs, "Shared Libraries") {
        Container(identity_pkg, "Identity Package", "@nexiom/identity", "Interfaces, Adapters, Guards")
    }

    ContainerDb(db_users, "Public Schema", "Postgres", "Users, Tenants, Memberships")
    
    Rel(api_layer, identity_pkg, "Injects Interfaces", "Dependency Injection")
    Rel(identity_pkg, db_users, "Manages", "Drizzle ORM")
```

---

## 2. The Identity & The 6-Layer Pipeline

Identity is an **Orthogonal Concern**—it intersects the pipeline layers rather than being a step within them.

### 2.1 Interaction Flow

```mermaid
sequenceDiagram
    autonumber
    participant Gateway as Layer 1 (Gateway)
    participant Worker as Layer 2-4 (Pipeline)
    participant Delivery as Layer 5 (Delivery)
    participant Identity as @nexiom/identity
    participant DB as Public Schema

    Note over Gateway: 1. Ingestion
    Gateway->>Identity: Validate Webhook Signature?
    Identity-->>Gateway: OK (Shared Secret Check)

    Note over Worker: 2. Processing
    Worker->>Identity: Resolve Tenant Context (envoy -> uuid)
    Identity->>DB: SELECT id FROM tenants WHERE slug = 'envoy'
    DB-->>Identity: tenant_uuid
    Identity-->>Worker: Context { tenantId: '...' }

    Note over Delivery: 5. Execution
    Delivery->>Identity: Get External App Credentials (Connection)
    Identity->>DB: Decrypt OAuth Tokens
    DB-->>Identity: Access Token
    Identity-->>Delivery: Credentials
```

### 2.2 Layer Responsibilities

| Pipeline Layer | Identity Responsibility | Interface Used |
| :--- | :--- | :--- |
| **L1: Gateway** | **Tenant Resolution** (Subdomain/Path) & **Signature Verification** (HMAC). | `ITenantProvider` |
| **L2: Replica** | **Context Injection** (Setting `AsyncLocalStorage`). | `ITenantProvider` |
| **L3: Norm** | N/A (Pure Logic) | N/A |
| **L4: Outbound**| N/A (Pure Logic) | N/A |
| **L5: Delivery** | **Credential Retrieval** (Decrypting OAuth tokens for destinations). | `ICredentialProvider` (Future) |
| **API (UI)** | **User Auth** (Session) & **RBAC** (Guards). | `IAuthProvider`, `IPermissionProvider` |

---

## 3. Core Design Decisions (ADRs)

### ADR-001: The Adapter Pattern

* **Context:** We want to support "SaaS-in-a-Box" where users can bring their own Auth (Clerk, Auth0) or Database.
* **Decision:** All Identity logic must sit behind **Interfaces**. The API Layer NEVER imports the ORM directly for Identity tables.
* **Consequences:**
  * (+) Zero vendor lock-in.
  * (+) Easy to mock for TDD.
  * (-) Slight boilerplate overhead (Interface + Adapter).

### ADR-002: Capability-Based Access Control (CBAC)

* **Context:** "Roles" (Admin, User) are too rigid for complex B2B apps.
* **Decision:** We perform checks on **Capabilities** (`create:tenant`, `read:report`), not Roles.
* **Consequences:**
  * (+) Granular control.
  * (+) Creating custom roles is just grouping capabilities.

---

## 4. Source Code Structure (The Blueprint)

### 4.1 Directory Map

```text
packages/identity/
├── src/
│   ├── interfaces/           # 👈 THE LAW (Contracts)
│   │   ├── auth.provider.interface.ts
│   │   ├── user.provider.interface.ts
│   │   ├── tenant.provider.interface.ts
│   │   ├── permission.provider.interface.ts
│   │
│   ├── adapters/             # 👈 THE WORKERS (Implementations)
│   │   ├── better-auth.adapter.ts    
│   │   ├── drizzle-user.adapter.ts
│   │   ├── drizzle-tenant.adapter.ts
│   │
│   ├── constants.ts          # Dependency Injection Tokens
│   └── identity.module.ts    # NestJS Dynamic Module
```

### 4.2 Key Interface Definitions

#### `ITenantProvider`

The "Landlord" of the system.

```typescript
export interface ITenantProvider {
  // Discovery
  findBySlug(slug: string): Promise<Tenant | null>;
  findById(id: string): Promise<Tenant | null>;
  
  // Resolution
  resolveContext(request: Request): Promise<TenantContext>; 

  // Lifecycle
  create(userId: string, name: string): Promise<Tenant>;
  provisionTenantForUser(userId: string): Promise<Tenant>; // "Sign up and give me a workspace"
}
```

#### `IPermissionProvider`

The "Bouncer" of the system.

```typescript
export interface IPermissionProvider {
  // The only method you actually need
  can(user: User, action: string, resource: string): Promise<boolean>;
  
  // Example usage:
  // can(user, 'delete', 'production_db')
}
```

---

## 5. Flow Diagram: The "Strict Layer" Request

How a `GET /admin/users` request travels through the refined architecture.

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Controller as SystemAdminController
    participant Guard as AuthGuard
    participant UserProvider as DI Token (USER_PROVIDER)
    participant Adapter as DrizzleUserAdapter
    participant DB as Postgres

    Client->>Controller: GET /admin/users
    
    rect rgb(240, 248, 255)
        Note right of Client: 1. Authentication Layer
        Controller->>Guard: canActivate()
        Guard->>Adapter: validateSession(token)
        Adapter-->>Guard: User Session
    end

    rect rgb(255, 240, 245)
        Note right of Client: 2. Application Layer
        Controller->>UserProvider: findAll({ tenantId: '...' })
        Note over Controller: Controller does NOT know about Drizzle/SQL
    end

    rect rgb(240, 255, 240)
        Note right of Client: 3. Infrastructure Layer
        UserProvider->>Adapter: Adapter.findAll()
        Adapter->>DB: db.select().from(users)...
        DB-->>Adapter: Result Rows
        Adapter-->>UserProvider: Mapped User[]
    end

    UserProvider-->>Controller: User[]
    Controller-->>Client: 200 OK
```
