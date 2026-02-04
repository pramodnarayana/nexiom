# Flexible Identity Strategy: "The Plan-Driven Architecture"

**Objective:** Identity behavior, constraints, and UI features are entirely driven by the **Billing Plan** associated with the Tenant.

## 1. Core Strategy: "Everything is a Tenant"

We reject the "User vs. Org" split in favor of a unified model where every workspace is a Tenant.

* **Architecture:** Every entity is a `Tenant`.
* **Differentiation:** A "Personal Workspace" is simply a Tenant on the **Free Plan** with a **Member Limit of 1**.
* **Consistency:** The backend code is uniform. We don't write `if (isPersonal)`. We write `if (tenant.plan.canInviteMembers)`.

## 2. Industry Comparison: Validating the Model

This "Workspace-First" model is the modern standard for B2B SaaS.

| Company | Model | Similarity to Our Strategy |
| :--- | :--- | :--- |
| **Linear** | Everything is a Workspace. Free plan has limits. | **High:** Very similar. Cleanest approach. |
| **Vercel** | Personal Account vs Team. | **Medium:** They distinguish Personal vs Team scopes more explicitly. |
| **Slack** | Everything is a Workspace. | **High:** Free vs Standard vs Enterprise Grid. |
| **Notion** | User has a "Private" space + Workspaces. | **Low:** More complex data segregation. |

**Verdict:** Your proposed strategy aligns perfectly with the **Linear / Slack** model, which is superior for maintainability.

---

## 3. Tier Definitions & Constraints

We map the generic Identity capabilities to specific Billing Plans.

### 3.1 Personal Plan (The "Individual")

* **Target:** Freelancers, Solo devs.
* **Billing:** Free ($0).
* **Constraint:** `MAX_MEMBERS = 1`.
* **Identity Features:**
  * **Roles:** Locked to `Owner` only.
  * **UI Hiding:** Hides "Team Settings", "SSO", "Audit Logs".
  * **Invite Flow:** Disabled (Upgrade Prompt).

### 3.2 Pro Plan (The "Startup")

* **Target:** Small teams.
* **Billing:** Per-Seat (e.g., $20/user).
* **Constraint:** `MAX_MEMBERS = 10` (or 50).
* **Identity Features:**
  * **Roles:** `Owner`, `Admin`, `Member` (Standard System Roles).
  * **UI:** Shows "Team Settings".
  * **SSO:** Disabled.

### 3.3 Enterprise Plan (The "Corp")

* **Target:** Large organizations.
* **Billing:** Custom / Volume.
* **Constraint:** `MAX_MEMBERS = Unlimited`.
* **Identity Features:**
  * **Roles:** Custom Role Creation enabled (`can:manage:roles`).
  * **SSO:** SAML/OIDC Configuration unlocked.
  * **Audit:** Full Audit Log access.

---

## 4. Architecture Implementation Details

This section outlines exactly how we implement this strategy in code.

### 4.1 configuration: `plans.config.ts` (The Source of Truth)

We define our plans in code (or fetch from Billing Service/Lago).

```typescript
// packages/identity/src/config/plans.config.ts

export const PLANS = {
  free: {
    id: 'free',
    name: 'Personal',
    limits: {
      maxMembers: 1,
      maxProjects: 3,
    },
    features: ['basic_auth'],
  },
  pro: {
    id: 'pro',
    name: 'Startup',
    limits: {
      maxMembers: 10,
      maxProjects: 100,
    },
    features: ['basic_auth', 'team_management', 'invite_members'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    limits: {
      maxMembers: Infinity,
      maxProjects: Infinity,
    },
    features: ['basic_auth', 'team_management', 'invite_members', 'sso', 'audit_logs', 'custom_roles'],
  },
};
```

### 4.2 Database Schema: Linking Tenant to Plan

We add `planId` to the Organization table.

```typescript
// packages/identity/src/schema.ts

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  // ... other fields
  planId: text("planId").notNull().default("free"), // Links to PLANS config
  subscriptionStatus: text("subscriptionStatus"),   // 'active', 'past_due', 'canceled'
});
```

### 4.3 Service Layer: The `CapabilityService`

We abstract the logic so controllers never check `planId` directly. They check **Capabilities**.

```typescript
// packages/identity/src/services/CapabilityService.ts

export class CapabilityService {
  constructor(private readonly tenant: Organization) {}

  private getPlan() {
    return PLANS[this.tenant.planId] || PLANS.free;
  }

  // Check Limit
  async canInviteMembers(currentMemberCount: number): Promise<boolean> {
    const limit = this.getPlan().limits.maxMembers;
    return currentMemberCount < limit;
  }

  // Check Feature
  hasFeature(feature: string): boolean {
    return this.getPlan().features.includes(feature);
  }
}
```

### 4.4 API Guard: Enforcing Limits

We use a Guard or Interceptor to block requests that exceed limits.

```typescript
// apps/api/src/guards/plan-limit.guard.ts

async canActivate(context: ExecutionContext): Promise<boolean> {
  const request = context.switchToHttp().getRequest();
  const tenant = request.tenant;
  
  if (request.path.includes('/invite')) {
    const currentCount = await this.memberRepo.count(tenant.id);
    const capability = new CapabilityService(tenant);
    
    if (!await capability.canInviteMembers(currentCount)) {
      throw new ForbiddenException("Upgrade your plan to invite more members.");
    }
  }
  return true;
}
```

### 4.5 Frontend: UI Adaptation

The frontend receives the `tenant` object with its `planId` (or hydrated features).

```tsx
// apps/web/src/pages/TeamSettings.tsx

const { tenant } = useTenant();
const plan = PLANS[tenant.planId];

return (
  <div>
    <h1>Team Settings</h1>
    
    {/* Feature Flag: SSO */}
    {plan.features.includes('sso') ? (
      <SSOSettings /> 
    ) : (
      <UpgradeBanner feature="SSO" />
    )}

    {/* Limit Check: Invite Button */}
    {memberCount >= plan.limits.maxMembers ? (
      <DisableInviteButton reason="Limit Reached" />
    ) : (
      <InviteButton />
    )}
  </div>
);
```

## 5. Migration Strategy

1. **Default:** All existing Organizations will default to `planId: 'free'`.
2. **Upgrade:** We will write a migration script to set known "Team" orgs to `planId: 'pro'`.
3. **Billing Sync:** When Lago (Billing) confirms a subscription update, a webhook will update the `planId` in our database.

---
**Summary:** This architecture decouples the code from today's specific pricing. If we change "Pro" to allow 20 members tomorrow, we just update `plans.config.ts`, and the entire app adapts automatically.
