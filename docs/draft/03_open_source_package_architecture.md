# Soopa Open Source Package Architecture

**Vision:** SaaS-in-a-Box - Build SaaS products in hours, not months  
**Status:** Architecture Design  
**Created:** 2026-01-22

---

## Executive Summary

Soopa provides **three open-source packages** that solve the boring, repetitive parts of building a SaaS product:

1. **@soopa/identity** - Authentication, Users, Multi-Tenancy
2. **@soopa/notifications** - Email, SMS, In-App, Push Notifications
3. **@soopa/billing** - Subscriptions, Usage Tracking, Invoicing

**Key Innovation:** **Pluggable architecture** - use our defaults (Better-Auth, Novu, Lago) or swap in your own providers (Clerk, Knock, Stripe, or custom).

**Developer Promise:** `npm install` → Configure → Ship your product

---

## The Problem We Solve

### Before Soopa (6 Months of Boring Work)

Every SaaS founder rebuilds the same infrastructure:

```
Weeks 1-4:   Authentication system
             - Signup, login, OAuth
             - Password reset, email verification
             - Session management

Weeks 5-8:   Multi-tenancy
             - Tenant isolation
             - User-tenant relationships
             - Role-based access control

Weeks 9-12:  Notification system
             - Email templates
             - SMS integration
             - In-app notifications
             - Notification preferences

Weeks 13-16: Billing system
             - Subscription plans
             - Payment processing
             - Invoice generation
             - Usage tracking

Weeks 17-20: Admin dashboard
             - User management UI
             - Tenant management UI
             - Billing portal

Week 21+:    FINALLY build your actual product
```

### With Soopa (1 Day)

```bash
npm install @soopa/identity @soopa/notifications @soopa/billing
# Configure in 30 minutes
# Start building your product immediately
```

---

## Architecture Overview

### The Three Packages

```mermaid
graph TB
    subgraph "Your SaaS Application"
        APP[Your Core Business Logic]
    end
    
    subgraph "Soopa Packages"
        IDENTITY[@soopa/identity<br/>Auth + Users + Tenants]
        NOTIF[@soopa/notifications<br/>Email + SMS + In-App]
        BILLING[@soopa/billing<br/>Subscriptions + Invoices]
    end
    
    subgraph "Pluggable Providers"
        AUTH_PROVIDERS[Better-Auth<br/>Clerk<br/>Auth0<br/>Custom]
        NOTIF_PROVIDERS[Novu<br/>Knock<br/>Courier<br/>Custom]
        BILL_PROVIDERS[Lago<br/>Stripe<br/>Chargebee<br/>Custom]
    end
    
    APP --> IDENTITY
    APP --> NOTIF
    APP --> BILLING
    
    IDENTITY --> AUTH_PROVIDERS
    NOTIF --> NOTIF_PROVIDERS
    BILLING --> BILL_PROVIDERS
    
    style IDENTITY fill:#4A90E2
    style NOTIF fill:#7ED321
    style BILLING fill:#F5A623
```

### Adapter Pattern Architecture

Each package defines **interfaces** and provides **default implementations**:

```typescript
// Interface (contract)
interface IAuthProvider {
  signUp(email: string, password: string): Promise<User>;
  signIn(email: string, password: string): Promise<Session>;
  signOut(sessionId: string): Promise<void>;
}

// Default implementation
class BetterAuthProvider implements IAuthProvider {
  async signUp(email, password) { /* Better-Auth logic */ }
  async signIn(email, password) { /* Better-Auth logic */ }
  async signOut(sessionId) { /* Better-Auth logic */ }
}

// Alternative implementation
class ClerkProvider implements IAuthProvider {
  async signUp(email, password) { /* Clerk logic */ }
  async signIn(email, password) { /* Clerk logic */ }
  async signOut(sessionId) { /* Clerk logic */ }
}

// Custom implementation
class CustomAuthProvider implements IAuthProvider {
  async signUp(email, password) { /* Your custom logic */ }
  async signIn(email, password) { /* Your custom logic */ }
  async signOut(sessionId) { /* Your custom logic */ }
}
```

---

## Package 1: @soopa/identity

### What It Provides

**Authentication:**

- User signup/login/logout
- OAuth (Google, GitHub, etc.)
- Password reset & email verification
- Session management
- Two-factor authentication (2FA)

**User Management:**

- User CRUD operations
- User profiles & metadata
- User search & filtering
- User permissions

**Multi-Tenancy:**

- Tenant (organization) CRUD
- Schema-per-tenant isolation
- Tenant invitations
- Member management
- Role-based access control (RBAC)

**Admin UI Components:**

- User management dashboard
- Tenant management dashboard
- Invitation flow
- Member directory

### Installation & Configuration

```bash
npm install @soopa/identity
```

**Option 1: Default (Better-Auth)**

```typescript
// app.module.ts
import { IdentityModule } from '@soopa/identity';

@Module({
  imports: [
    IdentityModule.forRoot({
      provider: 'better-auth',
      database: {
        url: process.env.DATABASE_URL,
      },
      multiTenant: {
        enabled: true,
        isolationStrategy: 'schema-per-tenant',
      },
      features: {
        oauth: true,
        invitations: true,
        twoFactor: true,
      },
    }),
  ],
})
export class AppModule {}
```

**Option 2: Clerk**

```typescript
IdentityModule.forRoot({
  provider: 'clerk',
  apiKey: process.env.CLERK_SECRET_KEY,
  multiTenant: {
    enabled: true,
    isolationStrategy: 'row-level-security',
  },
})
```

**Option 3: Custom Provider**

```typescript
import { CustomAuthProvider } from './custom-auth.provider';

IdentityModule.forRoot({
  provider: CustomAuthProvider,
  database: { url: process.env.DATABASE_URL },
  multiTenant: { enabled: true },
})
```

### Interface Definitions

```typescript
// IAuthProvider - Authentication operations
interface IAuthProvider {
  signUp(data: SignUpDto): Promise<User>;
  signIn(data: SignInDto): Promise<Session>;
  signOut(sessionId: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  verifyEmail(token: string): Promise<boolean>;
  refreshToken(refreshToken: string): Promise<Session>;
}

// IUserProvider - User management operations
interface IUserProvider {
  create(data: CreateUserDto): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  update(id: string, data: UpdateUserDto): Promise<User>;
  delete(id: string): Promise<void>;
  list(filters: UserFilters): Promise<PaginatedUsers>;
}

// ITenantProvider - Multi-tenancy operations
interface ITenantProvider {
  create(data: CreateTenantDto): Promise<Tenant>;
  findById(id: string): Promise<Tenant | null>;
  update(id: string, data: UpdateTenantDto): Promise<Tenant>;
  delete(id: string): Promise<void>;
  addMember(tenantId: string, userId: string, role: string): Promise<Member>;
  removeMember(tenantId: string, userId: string): Promise<void>;
  listMembers(tenantId: string): Promise<Member[]>;
  provisionSchema(tenantId: string): Promise<void>; // For schema-per-tenant
}

// IInvitationProvider - Invitation operations
interface IInvitationProvider {
  create(data: CreateInvitationDto): Promise<Invitation>;
  accept(token: string): Promise<Member>;
  revoke(id: string): Promise<void>;
  resend(id: string): Promise<void>;
  list(tenantId: string): Promise<Invitation[]>;
}
```

### Database Schema

```typescript
// User table (public schema)
{
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatar?: string;
  systemRole: 'platform_admin' | 'platform_user';
  createdAt: Date;
  updatedAt: Date;
}

// Tenant/Organization table (public schema)
{
  id: string;
  name: string;
  slug: string; // unique subdomain
  status: 'active' | 'suspended' | 'disabled';
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// Member table (public schema) - Links users to tenants
{
  id: string;
  userId: string;
  tenantId: string;
  role: 'admin' | 'user' | custom;
  createdAt: Date;
}

// Invitation table (public schema)
{
  id: string;
  email: string;
  tenantId?: string; // null for platform-level invites
  inviterId: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired';
  token: string;
  expiresAt: Date;
  createdAt: Date;
}
```

### React Components Provided

```typescript
// User management
<UserList />
<UserShow userId="123" />
<UserCreate />
<UserEdit userId="123" />

// Tenant management
<TenantList />
<TenantShow tenantId="abc" />
<TenantCreate />
<TenantEdit tenantId="abc" />

// Invitations
<InvitationForm />
<InvitationList />
<AcceptInvitationPage token="xyz" />

// Auth UI
<SignUpForm />
<SignInForm />
<ResetPasswordForm />
<VerifyEmailPage />
```

---

## Package 2: @soopa/notifications

### What It Provides

**Notification Channels:**

- Email notifications
- SMS notifications
- In-app notifications
- Push notifications (web/mobile)
- Slack/Teams webhooks

**Features:**

- Template management
- Multi-language support
- User preferences (opt-in/opt-out)
- Notification history
- Delivery tracking
- Retry logic for failures

**Admin UI Components:**

- Template editor
- Notification history
- User preference management
- Delivery analytics

### Installation & Configuration

```bash
npm install @soopa/notifications
```

**Option 1: Default (Novu)**

```typescript
import { NotificationModule } from '@soopa/notifications';

@Module({
  imports: [
    NotificationModule.forRoot({
      provider: 'novu',
      apiKey: process.env.NOVU_API_KEY,
      channels: {
        email: true,
        sms: true,
        inApp: true,
        push: true,
      },
      defaults: {
        from: 'notifications@yourapp.com',
      },
    }),
  ],
})
export class AppModule {}
```

**Option 2: Knock**

```typescript
NotificationModule.forRoot({
  provider: 'knock',
  apiKey: process.env.KNOCK_API_KEY,
  channels: { email: true, sms: true },
})
```

**Option 3: Custom (Nodemailer + Twilio)**

```typescript
import { CustomNotificationProvider } from './custom-notification.provider';

NotificationModule.forRoot({
  provider: CustomNotificationProvider,
  config: {
    email: {
      host: process.env.SMTP_HOST,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    sms: {
      accountSid: process.env.TWILIO_SID,
      authToken: process.env.TWILIO_TOKEN,
    },
  },
})
```

### Interface Definitions

```typescript
// INotificationProvider - Core notification operations
interface INotificationProvider {
  send(notification: SendNotificationDto): Promise<NotificationResult>;
  sendBatch(notifications: SendNotificationDto[]): Promise<NotificationResult[]>;
  getStatus(notificationId: string): Promise<NotificationStatus>;
  cancel(notificationId: string): Promise<void>;
}

// ITemplateProvider - Template management
interface ITemplateProvider {
  create(template: CreateTemplateDto): Promise<Template>;
  update(id: string, template: UpdateTemplateDto): Promise<Template>;
  delete(id: string): Promise<void>;
  render(templateId: string, variables: Record<string, any>): Promise<string>;
}

// IPreferenceProvider - User notification preferences
interface IPreferenceProvider {
  get(userId: string): Promise<NotificationPreferences>;
  update(userId: string, preferences: UpdatePreferencesDto): Promise<NotificationPreferences>;
  checkOptIn(userId: string, channel: NotificationChannel): Promise<boolean>;
}

// Types
type NotificationChannel = 'email' | 'sms' | 'in_app' | 'push' | 'slack';

interface SendNotificationDto {
  recipientId: string;
  channel: NotificationChannel;
  templateId: string;
  variables?: Record<string, any>;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  scheduledFor?: Date;
}

interface NotificationResult {
  id: string;
  status: 'sent' | 'failed' | 'pending';
  deliveredAt?: Date;
  error?: string;
}
```

### Usage Examples

```typescript
import { NotificationService } from '@soopa/notifications';

// Inject the service
constructor(private notifications: NotificationService) {}

// Send a single notification
await this.notifications.send({
  recipientId: 'user-123',
  channel: 'email',
  templateId: 'welcome-email',
  variables: { name: 'John', company: 'Acme Corp' },
});

// Send batch notifications
await this.notifications.sendBatch([
  { recipientId: 'user-1', channel: 'email', templateId: 'newsletter' },
  { recipientId: 'user-2', channel: 'email', templateId: 'newsletter' },
]);

// Schedule notification
await this.notifications.send({
  recipientId: 'user-123',
  channel: 'email',
  templateId: 'reminder',
  scheduledFor: new Date('2024-01-30T10:00:00Z'),
});

// Check opt-in status
const canSendSMS = await this.notifications.checkOptIn('user-123', 'sms');
```

### React Components Provided

```typescript
// Notification center
<NotificationCenter userId="123" />
<NotificationBell userId="123" />
<NotificationList userId="123" />

// Preferences
<NotificationPreferences userId="123" />

// Admin
<NotificationHistory />
<TemplateEditor />
<NotificationAnalytics />
```

---

## Package 3: @soopa/billing

### What It Provides

**Subscription Management:**

- Plan management (tiers, features, pricing)
- Subscription lifecycle (create, upgrade, downgrade, cancel)
- Trial periods & grace periods
- Proration calculations

**Usage Tracking:**

- Metered billing (API calls, storage, seats)
- Usage aggregation
- Overage charges

**Invoicing:**

- Invoice generation
- Payment processing
- Receipt generation
- Tax calculations

**Customer Portal:**

- Subscription management UI
- Payment method management
- Invoice history
- Usage dashboard

### Installation & Configuration

```bash
npm install @soopa/billing
```

**Option 1: Default (Lago)**

```typescript
import { BillingModule } from '@soopa/billing';

@Module({
  imports: [
    BillingModule.forRoot({
      provider: 'lago',
      apiKey: process.env.LAGO_API_KEY,
      plans: [
        {
          id: 'starter',
          name: 'Starter',
          price: 29,
          interval: 'month',
          features: ['10-users', 'basic-support'],
        },
        {
          id: 'pro',
          name: 'Pro',
          price: 99,
          interval: 'month',
          features: ['unlimited-users', 'priority-support', 'api-access'],
        },
      ],
      metering: {
        enabled: true,
        dimensions: ['api_calls', 'storage_gb'],
      },
    }),
  ],
})
export class AppModule {}
```

**Option 2: Stripe Billing**

```typescript
BillingModule.forRoot({
  provider: 'stripe',
  apiKey: process.env.STRIPE_SECRET_KEY,
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  plans: [
    { id: 'price_starter', name: 'Starter' },
    { id: 'price_pro', name: 'Pro' },
  ],
})
```

**Option 3: Custom Provider**

```typescript
import { CustomBillingProvider } from './custom-billing.provider';

BillingModule.forRoot({
  provider: CustomBillingProvider,
  config: { /* your config */ },
})
```

### Interface Definitions

```typescript
// IBillingProvider - Core billing operations
interface IBillingProvider {
  // Subscriptions
  createSubscription(data: CreateSubscriptionDto): Promise<Subscription>;
  updateSubscription(id: string, data: UpdateSubscriptionDto): Promise<Subscription>;
  cancelSubscription(id: string, options?: CancelOptions): Promise<Subscription>;
  getSubscription(id: string): Promise<Subscription>;
  
  // Usage tracking
  trackUsage(data: TrackUsageDto): Promise<void>;
  getUsage(subscriptionId: string, period: Period): Promise<Usage>;
  
  // Invoices
  createInvoice(subscriptionId: string): Promise<Invoice>;
  getInvoice(id: string): Promise<Invoice>;
  listInvoices(customerId: string): Promise<Invoice[]>;
  
  // Payments
  createPaymentMethod(data: CreatePaymentMethodDto): Promise<PaymentMethod>;
  updatePaymentMethod(id: string, data: UpdatePaymentMethodDto): Promise<PaymentMethod>;
  deletePaymentMethod(id: string): Promise<void>;
}

// IPlanProvider - Plan management
interface IPlanProvider {
  create(plan: CreatePlanDto): Promise<Plan>;
  update(id: string, plan: UpdatePlanDto): Promise<Plan>;
  delete(id: string): Promise<void>;
  list(): Promise<Plan[]>;
}

// ICustomerProvider - Customer management
interface ICustomerProvider {
  create(data: CreateCustomerDto): Promise<Customer>;
  update(id: string, data: UpdateCustomerDto): Promise<Customer>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<Customer>;
}

// Types
interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAt?: Date;
  trialEnd?: Date;
}

interface Plan {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: 'month' | 'year';
  features: string[];
  metadata?: Record<string, any>;
}

interface Invoice {
  id: string;
  customerId: string;
  subscriptionId: string;
  amount: number;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  dueDate: Date;
  paidAt?: Date;
  lineItems: LineItem[];
}
```

### Usage Examples

```typescript
import { BillingService } from '@soopa/billing';

constructor(private billing: BillingService) {}

// Create subscription
const subscription = await this.billing.createSubscription({
  customerId: 'cust-123',
  planId: 'pro',
  paymentMethodId: 'pm-xyz',
  trialDays: 14,
});

// Track usage (for metered billing)
await this.billing.trackUsage({
  subscriptionId: 'sub-123',
  dimension: 'api_calls',
  quantity: 100,
  timestamp: new Date(),
});

// Upgrade/downgrade
await this.billing.updateSubscription('sub-123', {
  planId: 'enterprise',
  prorate: true,
});

// Cancel subscription
await this.billing.cancelSubscription('sub-123', {
  at: 'period_end', // or 'immediately'
});

// Get usage
const usage = await this.billing.getUsage('sub-123', {
  start: new Date('2024-01-01'),
  end: new Date('2024-01-31'),
});
```

### React Components Provided

```typescript
// Customer portal
<SubscriptionStatus customerId="123" />
<PlanSelector />
<PaymentMethodManager customerId="123" />
<InvoiceHistory customerId="123" />
<UsageDashboard subscriptionId="sub-123" />

// Admin
<CustomerList />
<SubscriptionList />
<PlanManager />
<BillingAnalytics />
```

---

## Package Structure

### Monorepo Organization

```
soopa/
├── packages/
│   ├── identity/
│   │   ├── src/
│   │   │   ├── providers/
│   │   │   │   ├── better-auth/
│   │   │   │   ├── clerk/
│   │   │   │   └── interfaces/
│   │   │   ├── services/
│   │   │   ├── controllers/
│   │   │   └── index.ts
│   │   ├── ui/
│   │   │   ├── components/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── README.md
│   │
│   ├── notifications/
│   │   ├── src/
│   │   │   ├── providers/
│   │   │   │   ├── novu/
│   │   │   │   ├── knock/
│   │   │   │   └── interfaces/
│   │   │   ├── services/
│   │   │   └── index.ts
│   │   ├── ui/
│   │   ├── package.json
│   │   └── README.md
│   │
│   └── billing/
│       ├── src/
│       │   ├── providers/
│       │   │   ├── lago/
│       │   │   ├── stripe/
│       │   │   └── interfaces/
│       │   ├── services/
│       │   └── index.ts
│       ├── ui/
│       ├── package.json
│       └── README.md
│
├── examples/
│   ├── nextjs-saas/
│   ├── nestjs-api/
│   └── express-api/
│
└── docs/
    ├── identity/
    ├── notifications/
    └── billing/
```

### Package Dependencies

```json
// @soopa/identity/package.json
{
  "name": "@soopa/identity",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "drizzle-orm": "^0.30.0"
  },
  "dependencies": {
    "better-auth": "^1.0.0"
  },
  "optionalDependencies": {
    "@clerk/backend": "^1.0.0"
  }
}
```

---

## Migration Strategy

### Phase 1: Extract to Packages (Week 1-2)

**Goal:** Move existing code into packages

1. Create monorepo structure
2. Extract auth/user/tenant modules → `@soopa/identity`
3. Extract email module → `@soopa/notifications`
4. Create billing module → `@soopa/billing` (new)

### Phase 2: Abstract Providers (Week 3-4)

**Goal:** Create adapter interfaces

1. Define `IAuthProvider`, `IUserProvider`, `ITenantProvider`
2. Wrap Better-Auth as `BetterAuthProvider`
3. Define `INotificationProvider`
4. Wrap Nodemailer as default provider
5. Define `IBillingProvider`
6. Implement Lago as default

### Phase 3: Build Alternatives (Week 5-6)

**Goal:** Implement alternative providers

1. Build `ClerkProvider` for identity
2. Build `NovuProvider` for notifications
3. Build `StripeProvider` for billing

### Phase 4: Documentation & Examples (Week 7-8)

**Goal:** Developer experience

1. Write comprehensive README for each package
2. Create example apps (Next.js, NestJS, Express)
3. API documentation (TypeDoc)
4. Video tutorials

### Phase 5: Open Source Launch (Week 9)

**Goal:** Public release

1. Choose license (MIT recommended)
2. Publish to npm
3. Launch on GitHub
4. Product Hunt launch
5. Dev.to / Hashnode articles

---

## Developer Experience

### Quick Start (5 minutes)

```bash
# Install packages
npm install @soopa/identity @soopa/notifications @soopa/billing

# Generate config
npx soopa init

# Run migrations
npx soopa migrate

# Start your app
npm run dev
```

### Configuration File

```typescript
// soopa.config.ts
export default {
  identity: {
    provider: 'better-auth',
    multiTenant: true,
    features: ['oauth', 'invitations', '2fa'],
  },
  notifications: {
    provider: 'novu',
    channels: ['email', 'sms', 'in-app'],
    defaults: { from: 'no-reply@yourapp.com' },
  },
  billing: {
    provider: 'lago',
    plans: [
      { id: 'starter', price: 29, interval: 'month' },
      { id: 'pro', price: 99, interval: 'month' },
    ],
  },
};
```

### CLI Tool

```bash
# Initialize Soopa in existing project
npx soopa init

# Run database migrations
npx soopa migrate

# Generate API documentation
npx soopa docs

# Create new tenant (development)
npx soopa tenant create --name="Acme Corp"

# Seed demo data
npx soopa seed
```

---

## Licensing Strategy

### Recommended: MIT License

**Pros:**

- ✅ Maximum adoption (no restrictions)
- ✅ Commercial use allowed
- ✅ Can be integrated into proprietary products
- ✅ Builds community goodwill

**Cons:**

- ❌ No revenue from license sales
- ❌ Competitors can fork and rebrand

### Monetization Strategy

**Free Forever:**

- All three packages (identity, notifications, billing)
- Self-hosted
- Community support

**Paid Offerings:**

- **Soopa Cloud** - Hosted version with managed infrastructure
- **Enterprise Support** - SLA, priority bug fixes, private Slack
- **Custom Development** - Build custom providers for enterprise customers
- **Training & Consulting** - Help teams implement Soopa

---

## Success Metrics

### Adoption Metrics

- npm downloads per week: **Target 10k+**
- GitHub stars: **Target 5k+**
- Active community members: **Target 1k+**
- Case studies: **Target 50+ companies**

### Quality Metrics

- Test coverage: **90%+**
- TypeScript strict mode: **100%**
- Documentation coverage: **100%**
- Time to "Hello World": **< 5 minutes**

---

## Roadmap

### Q1 2024: Foundation

- ✅ Extract packages from monolith
- ✅ Define adapter interfaces
- ✅ Implement default providers
- ✅ Write comprehensive docs

### Q2 2024: Alternative Providers

- Build Clerk adapter
- Build Novu adapter
- Build Stripe Billing adapter
- Create example apps

### Q3 2024: Open Source Launch

- Publish to npm
- GitHub launch
- Marketing campaign
- Community building

### Q4 2024: Ecosystem Growth

- Supabase Auth adapter
- Auth0 adapter
- Twilio SMS adapter
- AWS SES email adapter
- Chargebee billing adapter

---

## Critical Decisions

### Decision 1: Framework-Specific vs Framework-Agnostic?

**Option A: NestJS-Specific (Recommended)**

- ✅ Faster development (use NestJS DI, modules)
- ✅ Better integration with NestJS ecosystem
- ✅ Easier to maintain
- ❌ Limited to NestJS users

**Option B: Framework-Agnostic**

- ✅ Works with Express, Fastify, Hono, etc.
- ✅ Broader adoption
- ❌ More complex (need to abstract DI, HTTP layer)
- ❌ Slower development

**Recommendation:** Start NestJS-specific, extract framework-agnostic core later

### Decision 2: Separate Repos vs Monorepo?

**Option A: Monorepo (Recommended)**

- ✅ Easier to maintain
- ✅ Shared tooling & CI/CD
- ✅ Consistent versioning
- ✅ Cross-package refactoring

**Option B: Separate Repos**

- ✅ Independent versioning
- ✅ Smaller clone size
- ❌ Harder to coordinate changes
- ❌ Duplicate tooling

**Recommendation:** Monorepo with independent npm packages

### Decision 3: React Components Included?

**Option A: Include React Components (Recommended)**

- ✅ Complete solution (backend + frontend)
- ✅ Faster time to market
- ✅ Better developer experience
- ❌ Larger package size

**Option B: Separate UI Package**

- ✅ Smaller core package
- ✅ Framework-agnostic core
- ❌ Requires two npm installs
- ❌ More complex setup

**Recommendation:** Include React components in main packages, add Vue/Svelte support later

---

## Next Steps

1. **Validate Architecture** with stakeholders
2. **Create package structure** in monorepo
3. **Extract identity module** as first package
4. **Write comprehensive tests** (90%+ coverage)
5. **Document APIs** with TypeDoc
6. **Build example app** (Next.js SaaS starter)
7. **Launch beta** to select customers
8. **Iterate based on feedback**
9. **Public launch** on GitHub
10. **Marketing campaign** (Product Hunt, HN, etc.)

---

**Status:** Architecture design complete - Ready for implementation  
**Next Review:** After Phase 1 extraction is complete
