# Soopa Platform - Product Architecture

**Document Status:** DRAFT
**Version:** 1.0
**Last Updated:** 2026-01-22
**Author:** Platform Architecture Team

---

## Executive Summary

Soopa is a **B2B Integration Platform (iPaaS)** that enables seamless data exchange between business applications. The platform separates the **Infrastructure** (The Engine) from **Integration Logic** (The Connectors), providing a scalable, secure, and maintainable solution for modern business connectivity.

### Vision

To become the leading self-hosted iPaaS solution for mid-market and enterprise companies, providing QuickBooks Desktop integration and extensible connector framework for any business application.

### Mission

Deliver a production-grade platform that:

- **Simplifies** B2B data integration
- **Scales** from 10 to 10,000+ tenants
- **Secures** multi-tenant data isolation
- **Enables** rapid connector development

---

## System Overview

### Core Capabilities

| Capability | Description | Status |
|------------|-------------|--------|
| **Multi-Tenancy** | Isolated data and execution per tenant | ✅ Implemented |
| **Authentication** | Self-hosted auth with role-based access | ✅ Implemented |
| **User Management** | Platform and tenant-level user management | ✅ Implemented |
| **Admin Dashboard** | Platform administration interface | ✅ Implemented |
| **Connector Framework** | Pluggable connector architecture | 🔄 In Design |
| **Pipeline Engine** | Data transformation and routing | 🔄 In Design |
| **Monitoring** | Real-time sync monitoring and alerts | 📋 Planned |
| **API Gateway** | RESTful API for integrations | 📋 Planned |

---

## Architecture Principles

### 1. **Separation of Concerns**

- **Platform Layer:** Multi-tenancy, auth, user management
- **Integration Layer:** Connectors, pipelines, transformations
- **Data Layer:** Tenant isolation, schema management

### 2. **Scalability First**

- Horizontal scaling for API and workers
- Database connection pooling
- Queue-based async processing
- Distributed caching (future)

### 3. **Security by Design**

- Row-level security for multi-tenancy
- Encrypted credentials storage
- RBAC with granular permissions
- Audit logging

### 4. **Developer Experience**

- Type-safe APIs (TypeScript)
- Auto-generated documentation
- Hot reload in development
- Comprehensive testing

### 5. **Operational Excellence**

- Infrastructure as Code
- Automated deployments
- Health checks and monitoring
- Disaster recovery

---

## System Architecture

### High-Level Architecture Diagram

```mermaid
graph TB
    subgraph "Client Layer"
        WEB[Admin Dashboard<br/>React + Vite]
        PORTAL[Tenant Portal<br/>Future]
        MOBILE[Mobile App<br/>Future]
    end
    
    subgraph "API Gateway Layer"
        LB[Load Balancer]
        RATE[Rate Limiter]
        AUTH[Auth Middleware]
    end
    
    subgraph "Application Layer"
        API[Platform API<br/>NestJS]
        ENGINE[Integration Engine<br/>Future]
    end
    
    subgraph "API Services"
        AUTH_SVC[Authentication]
        USER_SVC[Users Service]
        TENANT_SVC[Tenants Service]
        ADMIN_SVC[Admin Service]
    end
    
    subgraph "Integration Services"
        CONN[Connector Framework]
        PIPE[Pipeline Engine]
        TRANS[Transform Service]
        HOOK[Webhook Manager]
    end
    
    subgraph "Data Layer"
        PG[(PostgreSQL<br/>Multi-tenant)]
        REDIS[(Redis<br/>Cache + Queue)]
    end
    
    WEB --> LB
    PORTAL --> LB
    MOBILE --> LB
    
    LB --> RATE
    RATE --> AUTH
    AUTH --> API
    AUTH --> ENGINE
    
    API --> AUTH_SVC
    API --> USER_SVC
    API --> TENANT_SVC
    API --> ADMIN_SVC
    
    ENGINE --> CONN
    ENGINE --> PIPE
    ENGINE --> TRANS
    ENGINE --> HOOK
    
    AUTH_SVC --> PG
    USER_SVC --> PG
    TENANT_SVC --> PG
    ADMIN_SVC --> PG
    
    CONN --> PG
    PIPE --> REDIS
    TRANS --> PG
    HOOK --> REDIS
    
    style WEB fill:#4A90E2
    style API fill:#7ED321
    style ENGINE fill:#F5A623
    style PG fill:#BD10E0
    style REDIS fill:#D0021B
```

### Component Interaction Flow

```mermaid
sequenceDiagram
    participant U as User
    participant W as Web Dashboard
    participant A as API Gateway
    participant S as Service Layer
    participant D as Database
    
    U->>W: Login Request
    W->>A: POST /api/auth/login
    A->>S: Validate Credentials
    S->>D: Query User
    D-->>S: User Data
    S->>S: Generate Session
    S-->>A: Session Token
    A-->>W: Set Cookie
    W-->>U: Dashboard
    
    U->>W: View Users
    W->>A: GET /api/admin/users
    A->>A: Validate Session
    A->>A: Check Permissions
    A->>S: Fetch Users
    S->>D: Query with tenant_id
    D-->>S: User List
    S-->>A: Filtered Data
    A-->>W: JSON Response
    W-->>U: Display Users
```

### Data Flow Architecture

```mermaid
flowchart LR
    subgraph "External Systems"
        QB[QuickBooks]
        FRAPPE[Frappe ERP]
        API_EXT[External API]
    end
    
    subgraph "Soopa Platform"
        CONN[Connectors]
        PIPE[Pipelines]
        TRANS[Transformers]
        QUEUE[Job Queue]
    end
    
    subgraph "Storage"
        DB[(Database)]
        CACHE[(Cache)]
    end
    
    QB -->|Pull Data| CONN
    FRAPPE -->|Pull Data| CONN
    API_EXT -->|Webhooks| CONN
    
    CONN -->|Raw Data| PIPE
    PIPE -->|Process| TRANS
    TRANS -->|Validate| QUEUE
    
    QUEUE -->|Store| DB
    QUEUE -->|Cache| CACHE
    
    DB -->|Read| PIPE
    CACHE -->|Read| PIPE
    
    PIPE -->|Push Data| QB
    PIPE -->|Push Data| FRAPPE
    PIPE -->|Push Data| API_EXT
```

### Technology Stack

**Frontend:**

- React 19 + TypeScript
- Vite (Build tool)
- Refine (Admin framework)
- shadcn/ui + Radix UI
- Tailwind CSS

**Backend:**

- NestJS 11 + TypeScript
- Drizzle ORM
- PostgreSQL 14+
- Better Auth (Self-hosted)
- Nodemailer (Email)

**Infrastructure:**

- Docker + Docker Compose
- pnpm + Turborepo (Monorepo)
- GitHub Actions (CI/CD - planned)
- AWS/DigitalOcean (Deployment - planned)

---

## Module Breakdown

### 1. Platform Core (✅ Implemented)

**Purpose:** Foundation layer providing multi-tenancy, authentication, and user management

**Components:**

- Authentication & Authorization
- User Management
- Tenant Management  
- System Administration
- Email Service

**Status:** Production-ready with platform_admin and platform_user roles

---

### 2. Integration Engine (🔄 In Design)

**Purpose:** Core engine for data synchronization and transformation

**Components:**

- Connector Framework
- Pipeline Engine
- Transformation Service
- Webhook Manager
- Job Queue

**Status:** Architecture design phase

---

### 3. Connectors (📋 Planned)

**Purpose:** Pre-built integrations for business applications

**Priority Connectors:**

1. QuickBooks Desktop (Web Connector)
2. QuickBooks Online (OAuth)
3. Frappe ERPNext
4. Generic EDI
5. Custom CSV/Excel
6. REST API Generic

**Status:** Awaiting integration engine

---

### 4. Monitoring & Observability (📋 Planned)

**Purpose:** Real-time insights into platform health and sync operations

**Components:**

- Metrics Collection (Prometheus)
- Log Aggregation (Winston/Pino)
- Error Tracking (Sentry)
- Usage Analytics
- Audit Trails

**Status:** Not started

---

### 5. API Gateway (📋 Planned)

**Purpose:** Public-facing API for third-party integrations

**Components:**

- REST API
- GraphQL (optional)
- Webhook Endpoints
- API Key Management
- Rate Limiting

**Status:** Not started

---

## Data Architecture

### Multi-Tenancy Model

**Approach:** Shared schema with tenant_id foreign keys

**Benefits:**

- Simplified maintenance
- Cost-effective
- Easy backups

**Security:**

- Row-Level Security (RLS) policies
- Application-level tenant isolation
- Encrypted tenant credentials

### Database Schema Organization

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : has
    USERS ||--o{ ACCOUNTS : has
   USERS }o--|| ORGANIZATIONS : "belongs to"
    ORGANIZATIONS ||--o{ INVITATIONS : sends
    ORGANIZATIONS ||--o{ CONNECTIONS : has
    CONNECTIONS }o--|| CONNECTORS : uses
    ORGANIZATIONS ||--o{ PIPELINES : owns
    PIPELINES }o--|| CONNECTIONS : "source"
    PIPELINES }o--|| CONNECTIONS : "destination"
    PIPELINES ||--o{ SYNC_LOGS : generates
    SYNC_LOGS ||--o{ SYNC_ERRORS : contains
    ORGANIZATIONS ||--o{ WEBHOOKS : configures
    
    USERS {
        uuid id PK
        string email
        string name
        string systemRole
        uuid organizationId FK
        timestamp createdAt
    }
    
    ORGANIZATIONS {
        uuid id PK
        string name
        string slug
        string status
        jsonb metadata
        timestamp createdAt
    }
    
    CONNECTORS {
        uuid id PK
        string name
        string type
        string version
        jsonb config_schema
        boolean is_active
    }
    
    CONNECTIONS {
        uuid id PK
        uuid tenant_id FK
        uuid connector_id FK
        string name
        jsonb credentials
        jsonb config
        string status
    }
    
    PIPELINES {
        uuid id PK
        uuid tenant_id FK
        uuid source_connection_id FK
        uuid destination_connection_id FK
        jsonb transformation_config
        string schedule_cron
        boolean is_active
    }
    
    SYNC_LOGS {
        uuid id PK
        uuid pipeline_id FK
        string job_id
        string status
        int records_processed
        int records_success
        int records_failed
        text error_message
        timestamp started_at
        timestamp completed_at
    }
```

---

## Security Architecture

### Authentication Flow Diagram

```mermaid
sequenceDiagram
    participant C as Client
    participant API as API Server
    participant BA as Better Auth
    participant DB as Database
    participant SESS as Session Store
    
    Note over C,SESS: Login Flow
    C->>API: POST /api/auth/login {email, password}
    API->>BA: Validate Credentials
    BA->>DB: SELECT * FROM users WHERE email = ?
    DB-->>BA: User Record
    BA->>BA: Verify Password (bcrypt)
    alt Valid Credentials
        BA->>SESS: Create Session
        SESS-->>BA: Session ID
        BA->>DB: INSERT INTO sessions
        BA-->>API: Session Token
        API-->>C: Set-Cookie: session=xxx (httpOnly, secure)
        C->>C: Redirect to Dashboard
    else Invalid Credentials
        BA-->>API: Invalid credentials error
        API-->>C: 401 Unauthorized
    end
    
    Note over C,SESS: Authenticated Request Flow
    C->>API: GET /api/admin/users
    Note right of C: Cookie: session=xxx
    API->>BA: Validate Session
    BA->>SESS: GET session by ID
    SESS-->>BA: Session Data
    alt Valid Session
        BA->>DB: SELECT * FROM users WHERE id = session.userId
        DB-->>BA: User Data
        BA->>BA: Check systemRole
        alt Has Permission
            BA-->>API: User Object
            API->>API: Execute Business Logic
            API->>DB: Query Data (with tenant_id filter)
            DB-->>API: Filtered Results
            API-->>C: 200 OK {data}
        else No Permission
            BA-->>API: Permission denied
            API-->>C: 403 Forbidden
        end
    else Invalid Session
        BA-->>API: Session invalid/expired
        API-->>C: 401 Unauthorized
    end
```

### Authorization Model Diagram

```mermaid
graph TD
    USER[User Request]
    GUARD[Auth Guard]
    SESSION{Valid Session?}
    ROLE{Check Role}
    PERM{Check Permission}
    EXEC[Execute Action]
    DENY403[403 Forbidden]
    DENY401[401 Unauthorized]
    
    USER --> GUARD
    GUARD --> SESSION
    SESSION -->|No| DENY401
    SESSION -->|Yes| ROLE
    
    ROLE -->|platform_admin| PERM
    ROLE -->|platform_user| PERM
    ROLE -->|tenant_admin| PERM
    ROLE -->|tenant_user| PERM
    ROLE -->|Unknown| DENY403
    
    PERM -->|Read Only| EXEC
    PERM -->|Write| ROLE2{Admin Role?}
    ROLE2 -->|Yes| EXEC
    ROLE2 -->|No| DENY403
    
    EXEC --> RESPONSE[200 OK]
    
    style USER fill:#4A90E2
    style EXEC fill:#7ED321
    style DENY403 fill:#D0021B
    style DENY401 fill:#F5A623
```

### Authorization Model

**System Roles:**

- `platform_admin` - Full platform access
- `platform_user` - Read-only platform access
- `tenant_admin` - Full tenant access
- `tenant_user` - Tenant read/write access

**Permission System (Planned):**

- Resource-level permissions
- Action-level permissions (read, create, update, delete)
- Dynamic role assignment

---

## Deployment Architecture

### Development

- Local Docker containers
- Hot reload (Vite + NestJS watch)
- In-memory message queue

### Staging

- Docker Compose on single VM
- PostgreSQL container
- Nginx reverse proxy
- SSL with Let's Encrypt

### Production (Planned)

- Kubernetes cluster (AWS EKS or DigitalOcean)
- RDS PostgreSQL (Multi-AZ)
- Redis for caching and queues
- CloudWatch/Datadog monitoring
- Auto-scaling workers

---

## API Design

### RESTful Conventions

```
GET    /api/admin/users           # List users
POST   /api/admin/users           # Create user
GET    /api/admin/users/:id       # Get user details
PATCH  /api/admin/users/:id       # Update user
DELETE /api/admin/users/:id       # Delete user
POST   /api/admin/users/:id/invite # Send invitation
```

### Response Format

```json
{
  "data": { /* Resource data */ },
  "meta": {
    "total": 100,
    "page": 1,
    "pageSize": 20
  },
  "error": null
}
```

---

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| API Response Time (p95) | < 200ms | TBD |
| Page Load Time | < 2s | ~1.5s |
| Concurrent Users | 1000+ | TBD |
| Database Connections | < 100 | ~10 |
| Test Coverage | > 80% | 84% API, 95% Web |

---

## Scalability Roadmap

### Phase 1: Single Server (Current)

- 1-50 tenants
- 100-500 users
- Single API instance
- Single database

### Phase 2: Horizontal Scaling

- 50-500 tenants
- 500-5000 users
- Multiple API instances
- Read replicas
- Redis caching

### Phase 3: Distributed System

- 500+ tenants
- 5000+ users
- Kubernetes cluster
- Distributed queue
- Multi-region (optional)

---

## Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Data Loss** | Critical | Daily backups, point-in-time recovery |
| **Security Breach** | Critical | Penetration testing, security audits |
| **Performance Degradation** | High | Load testing, auto-scaling |
| **Vendor Lock-in** | Medium | Use open-source stack, avoid cloud-specific features |
| **Team Knowledge** | Medium | Documentation, pair programming |

---

## Success Metrics

### Technical Metrics

- ✅ Test coverage > 80%
- ✅ Build time < 30s
- ✅ Zero production errors
- ✅ API uptime > 99.9%

### Product Metrics

- Tenant onboarding time < 5 minutes
- Connector setup time < 10 minutes  
- Data sync success rate > 99%
- User satisfaction > 4.5/5

---

## Next Steps

1. **Immediate (Week 1-2)**
   - ✅ Platform user access implemented
   - ✅ Technical debt documented
   - Review and approve this architecture

2. **Short-term (Month 1-2)**
   - Design integration engine architecture
   - Define connector interface
   - Prototype QuickBooks Desktop connector

3. **Medium-term (Month 3-6)**
   - Implement integration engine
   - Build first 3 connectors
   - Deploy to staging environment

4. **Long-term (Month 6-12)**
   - Public API launch
   - Monitoring and observability
   - Multi-region deployment (if needed)

---

## References

- [Technology Stack](/Users/apple/.gemini/antigravity/brain/fd86219d-7e6d-4738-8aaf-19625d98804c/technology_stack.md)
- [Architecture Technical Debt](/Users/apple/.gemini/antigravity/brain/fd86219d-7e6d-4738-8aaf-19625d98804c/architecture_technical_debt.md)
- [Permission Architecture Analysis](/Users/apple/.gemini/antigravity/brain/fd86219d-7e6d-4738-8aaf-19625d98804c/permission_architecture_analysis.md)
- Old Documentation: `/docs/old/`
