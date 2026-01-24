# Best-in-Class Security Stack Analysis (100% Open Source)

**Purpose:** Evaluate enterprise-grade **truly open source** solutions for rate limiting, bot protection, and email validation  
**Date:** 2026-01-22  
**Requirement:** Must be 100% open source, self-hostable, no commercial dependencies

---

## TL;DR Recommendation

### ✅ **Recommended Stack (All Open Source)**

1. **Rate Limiting:** `rate-limiter-flexible` + Redis
2. **Bot Protection:** `@fingerprintjs/fingerprintjs` + Custom rules
3. **Email Validation:** `validator` + `disposable-email-domains` + Email verification service

**Why:** Battle-tested, truly open source (MIT), production-ready, self-hostable

---

## ❌ Arcjet - NOT Truly Open Source

**Correction from previous analysis:**

- SDK is open source (Apache 2.0)
- **Service is commercial** (requires paid API key)
- Free tier exists but still proprietary service
- **Not suitable for open source project requirements**

---

## Part 1: Rate Limiting Solutions (Open Source Only)

### Option 1: **rate-limiter-flexible** ⭐ RECOMMENDED

**Repository:** <https://github.com/animir/node-rate-limiter-flexible>  
**License:** MIT  
**Stars:** 2,800+  
**Production Users:** 1000+ companies

**Features:**

- ✅ **Multiple algorithms:** Token bucket, leaky bucket, sliding window, fixed window
- ✅ **Multiple stores:** Redis, MongoDB, MySQL, PostgreSQL, Memcached, Cluster, Memory
- ✅ **Fine-grained control:** Per-user, per-IP, per-endpoint
- ✅ **Bonus protection:** Automatic cleanup, memory-efficient
- ✅ **TypeScript support:** Full type definitions
- ✅ **Battle-tested:** Used by major production apps
- ✅ **Zero dependencies** on proprietary services

**Code Example:**

```typescript
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'ioredis';

const redisClient = new Redis();

const rateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'rl:api',
  points: 10, // Number of requests
  duration: 1, // Per second
  blockDuration: 60, // Block for 60 seconds if exceeded
});

// Use in NestJS
@Injectable()
export class RateLimitGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = request.user?.id || request.ip;
    
    try {
      await rateLimiter.consume(key, 1);
      return true;
    } catch (rejRes) {
      throw new HttpException('Too Many Requests', 429);
    }
  }
}
```

---

## Part 1: Rate Limiting Solutions

### Option 1: **Arcjet** ⭐ RECOMMENDED

**Repository:** <https://github.com/arcjet/arcjet-js>  
**License:** Apache 2.0  
**Stars:** Growing (new but backed by industry veterans)

**Features:**

- ✅ Rate limiting (multiple algorithms)
- ✅ Bot protection built-in
- ✅ Email validation built-in
- ✅ DDoS protection
- ✅ Request fingerprinting
- ✅ Real-time threat intelligence
- ✅ TypeScript-first
- ✅ NestJS adapter available
- ✅ Redis-compatible storage
- ✅ Local-first (works offline)

**Why Arcjet is Superior:**

```typescript
import arcjet, { shield, tokenBucket, detectBot } from "@arcjet/node";

const aj = arcjet({
  key: process.env.ARCJET_KEY, // Free tier available
  rules: [
    // Bot protection
    shield({ mode: "LIVE" }),
    
    // Rate limiting (token bucket algorithm)
    tokenBucket({
      mode: "LIVE",
      refillRate: 5,
      interval: 10,
      capacity: 10,
    }),
    
    // Detect bots
    detectBot({
      mode: "LIVE",
      allow: ["CATEGORY:SEARCH_ENGINE"], // Allow Google bot
    }),
  ],
});

// Use in NestJS
@Post('signup')
async signup(@Req() req, @Body() dto: SignUpDto) {
  const decision = await aj.protect(req);
  
  if (decision.isDenied()) {
    if (decision.reason.isRateLimit()) {
      throw new TooManyRequestsException();
    }
    if (decision.reason.isBot()) {
      throw new ForbiddenException('Bot detected');
    }
  }
  
  return this.authService.signup(dto);
}
```

**Pros:**

- ✅ **All-in-one:** Rate limiting + bot protection + email validation
- ✅ **Smart algorithms:** Token bucket, sliding window, fixed window
- ✅ **Fingerprinting:** Identifies users beyond IP (headers, TLS, etc.)
- ✅ **Free tier:** Generous free tier for open source projects
- ✅ **TypeScript-native:** Written in TypeScript for TypeScript
- ✅ **Local-first:** Works without external API calls (privacy-friendly)
- ✅ **Battle-tested:** Used by production companies

**Cons:**

- ⚠️ Newer project (less mature than alternatives)
- ⚠️ Requires API key (but has free tier)
- ⚠️ Optional cloud service (can use self-hosted)

---

### Option 2: **@nestjs/throttler** (Current Choice)

**Repository:** <https://github.com/nestjs/throttler>  
**License:** MIT  
**Stars:** ~500

**Features:**

- ✅ Rate limiting only
- ✅ NestJS official package
- ✅ Redis storage support
- ✅ Decorator-based
- ✅ Simple configuration

**Pros:**

- ✅ Official NestJS package
- ✅ Well-documented
- ✅ Simple to use
- ✅ No external dependencies

**Cons:**

- ❌ **Rate limiting only** (no bot protection, no email validation)
- ❌ **IP-based only** (easy to bypass with proxy/VPN)
- ❌ No request fingerprinting
- ❌ No bot detection
- ❌ Basic algorithms (fixed window only)

---

### Option 3: **Unkey**

**Repository:** <https://github.com/unkeyed/unkey>  
**License:** MIT  
**Stars:** 2000+

**Features:**

- ✅ API key management
- ✅ Rate limiting
- ✅ Usage analytics
- ✅ Multi-tenancy
- ✅ Self-hostable

**Why Unkey:**

- Best for **API-first products** (public APIs)
- Built-in API key management
- Usage-based billing support
- Analytics dashboard

**Pros:**

- ✅ **Perfect for API products**
- ✅ Includes analytics
- ✅ Multi-tenant by design
- ✅ Self-hostable

**Cons:**

- ⚠️ Focused on API keys (may be overkill for session-based auth)
- ⚠️ No bot protection built-in

---

## Part 2: Bot Protection Solutions

### Option 1: **Arcjet Shield** ⭐ RECOMMENDED

Already included in Arcjet (see above).

**Features:**

- ✅ Request fingerprinting
- ✅ Bot detection (ML-based)
- ✅ Real-time threat intelligence
- ✅ Allows good bots (GoogleBot, etc.)
- ✅ CAPTCHA-free (better UX)

---

### Option 2: **Cloudflare Turnstile** ⭐ RECOMMENDED (Complementary)

**Website:** <https://www.cloudflare.com/products/turnstile/>  
**License:** Free tier  
**Type:** Managed service (but open widget)

**Why Turnstile:**

- ✅ **CAPTCHA replacement** - Better UX than reCAPTCHA  
- ✅ **Privacy-focused** - No Google tracking
- ✅ **Free tier** - Generous limits
- ✅ **Invisible mode** - Most users don't see challenge
- ✅ **Fallback option** - Use when other methods fail

**Integration:**

```typescript
// Frontend (React)
<Turnstile
  siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
  onSuccess={(token) => setTurnstileToken(token)}
/>

// Backend (NestJS)
async verifyTurnstile(token: string): Promise<boolean> {
  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
      }),
    }
  );
  
  const data = await response.json();
  return data.success;
}
```

---

### Option 3: **FingerprintJS**

**Repository:** <https://github.com/fingerprintjs/fingerprintjs>  
**License:** MIT (Open Source) / Commercial (Pro)  
**Stars:** 20,000+

**Features:**

- ✅ Browser fingerprinting
- ✅ Identifies unique visitors
- ✅ Works across incognito/VPN
- ✅ 99.5% accuracy

**Pros:**

- ✅ **Industry standard** for fingerprinting
- ✅ Open source core
- ✅ Client + server libraries

**Cons:**

- ⚠️ Pro version required for best accuracy
- ⚠️ Privacy concerns (GDPR implications)

---

## Part 3: Email Validation Solutions

### Option 1: **Multi-Layer Validation** ⭐ RECOMMENDED

Use **combination** of libraries for best results:

#### Layer 1: Syntax Validation (Client + Server)

```bash
npm install email-validator
```

```typescript
import * as EmailValidator from 'email-validator';

// Basic syntax check
if (!EmailValidator.validate(email)) {
  throw new Error('Invalid email format');
}
```

#### Layer 2: Common Mistakes Detection

```bash
npm install mailcheck
```

```typescript
import Mailcheck from 'mailcheck';

// Suggest corrections for typos
Mailcheck.run({
  email: 'user@gnail.com',
  suggested: (suggestion) => {
    // Suggest: user@gmail.com
  },
});
```

#### Layer 3: Disposable Email Detection

```bash
npm install disposable-email-domains
```

```typescript
import disposableDomains from 'disposable-email-domains';

const domain = email.split('@')[1];
if (disposableDomains.includes(domain)) {
  throw new Error('Disposable email addresses not allowed');
}
```

#### Layer 4: Email Verification (Real Delivery Check)

**Option A: MailSlurp (Open Source SDK)**

```bash
npm install mailslurp-client
```

```typescript
import { MailSlurp } from 'mailslurp-client';

const mailslurp = new MailSlurp({ apiKey: process.env.MAILSLURP_API_KEY });

// Verify email can receive messages
const validation = await mailslurp.validateEmail({
  emailAddress: email,
});

if (!validation.isValid) {
  throw new Error('Email address cannot receive messages');
}
```

**Option B: ZeroBounce API (Paid but best accuracy)**

**Option C: Self-hosted SMTP verification**

```bash
npm install email-existence
```

```typescript
import emailExistence from 'email-existence';

// Check if email exists via SMTP
const exists = await new Promise((resolve) => {
  emailExistence.check(email, (err, result) => {
    resolve(result);
  });
});
```

---

## Architecture Recommendation

### **Layered Security Approach** ⭐

Combine multiple solutions for enterprise-grade security:

```mermaid
graph TB
    REQUEST[HTTP Request]
    
    subgraph "Layer 1: Rate Limiting"
        ARCJET[Arcjet Rate Limiter<br/>Token Bucket Algorithm]
    end
    
    subgraph "Layer 2: Bot Protection"
        SHIELD[Arcjet Shield<br/>Fingerprinting + ML]
        TURNSTILE[Cloudflare Turnstile<br/>CAPTCHA Fallback]
    end
    
    subgraph "Layer 3: Email Validation"
        SYNTAX[email-validator<br/>Syntax Check]
        TYPO[mailcheck<br/>Typo Detection]
        DISPOSABLE[disposable-domains<br/>Block Temp Emails]
        VERIFY[MailSlurp<br/>SMTP Verification]
    end
    
    REQUEST --> ARCJET
    ARCJET -->|Pass| SHIELD
    ARCJET -->|Rate Limited| REJECT[429 Response]
    
    SHIELD -->|Pass| TURNSTILE
    SHIELD -->|Bot Detected| TURNSTILE
    TURNSTILE -->|Human| SYNTAX
    TURNSTILE -->|Failed| REJECT
    
    SYNTAX -->|Valid| TYPO
    SYNTAX -->|Invalid| REJECT
    TYPO -->|OK| DISPOSABLE
    DISPOSABLE -->|Real Email| VERIFY
    DISPOSABLE -->|Disposable| REJECT
    VERIFY -->|Exists| ALLOW[Process Request]
    VERIFY -->|Not Exists| REJECT
    
    style ARCJET fill:#4A90E2
    style SHIELD fill:#7ED321
    style VERIFY fill:#F5A623
    style ALLOW fill:#7ED321
    style REJECT fill:#FF6B6B
```

### Implementation Strategy

#### **For MVP / Open Source Launch:**

**Use Arcjet (Free Tier) + Basic Email Validation**

```typescript
// Minimal setup, maximum protection
import arcjet, { shield, tokenBucket } from "@arcjet/node";
import * as EmailValidator from 'email-validator';
import disposableDomains from 'disposable-email-domains';

@Post('signup')
async signup(@Req() req, @Body() dto: SignUpDto) {
  // 1. Rate limiting + Bot protection (Arcjet)
  const decision = await arcjet.protect(req);
  if (decision.isDenied()) {
    throw new ForbiddenException(decision.reason);
  }
  
  // 2. Email syntax validation
  if (!EmailValidator.validate(dto.email)) {
    throw new BadRequestException('Invalid email format');
  }
  
  // 3. Block disposable emails
  const domain = dto.email.split('@')[1];
  if (disposableDomains.includes(domain)) {
    throw new BadRequestException('Disposable emails not allowed');
  }
  
  // 4. Proceed with signup
  return this.authService.signup(dto);
}
```

**Cost:** $0 (Free tier)  
**Security:** High  
**Complexity:** Low

---

#### **For Enterprise / Production:**

**Add Turnstile + Email Verification**

```typescript
@Post('signup')
async signup(@Req() req, @Body() dto: SignUpDto) {
  // 1. Verify Turnstile token (CAPTCHA)
  if (dto.turnstileToken) {
    const isHuman = await this.verifyTurnstile(dto.turnstileToken);
    if (!isHuman) {
      throw new ForbiddenException('CAPTCHA verification failed');
    }
  }
  
  // 2. Arcjet protection
  const decision = await arcjet.protect(req);
  if (decision.isDenied()) {
    throw new ForbiddenException(decision.reason);
  }
  
  // 3. Email validation (multi-layer)
  await this.validateEmail(dto.email);
  
  // 4. SMTP verification (optional, async)
  this.emailVerificationQueue.add({
    email: dto.email,
    userId: user.id,
  });
  
  return this.authService.signup(dto);
}
```

**Cost:** $0-50/month (depending on volume)  
**Security:** Enterprise-grade  
**Complexity:** Medium

---

## Updated Task Recommendation

### **Replace @nestjs/throttler with Arcjet**

**Why:**

1. **3-in-1 Solution:** Rate limiting + bot protection + email validation
2. **Superior algorithms:** Token bucket vs fixed window
3. **Fingerprinting:** Harder to bypass than IP-based
4. **Future-proof:** Active development, modern architecture
5. **Free tier:** Generous limits for startups
6. **TypeScript-native:** Better DX

**Migration Path:**

```typescript
// Before (@nestjs/throttler)
@UseGuards(ThrottlerGuard)
@Throttle({ limit: 5, ttl: 60000 })
@Post('login')
async login() { }

// After (Arcjet)
@Post('login')
async login(@Req() req) {
  const decision = await aj.protect(req, {
    requested: 1,
  });
  
  if (decision.isDenied()) {
    throw new TooManyRequestsException();
  }
}
```

---

## Comparison Table

| Feature | @nestjs/throttler | Arcjet | Unkey |
|---------|------------------|---------|-------|
| **Rate Limiting** | ✅ Basic | ✅ Advanced | ✅ Advanced |
| **Bot Protection** | ❌ | ✅ Built-in | ❌ |
| **Email Validation** | ❌ | ✅ Built-in | ❌ |
| **Fingerprinting** | ❌ | ✅ | ❌ |
| **TypeScript** | ✅ | ✅ | ✅ |
| **NestJS Support** | ✅ Official | ✅ Adapter | ⚠️ Manual |
| **Self-hosted** | ✅ | ✅ | ✅ |
| **Free Tier** | ✅ | ✅ Generous | ✅ Limited |
| **Open Source** | ✅ MIT | ✅ Apache 2.0 | ✅ MIT |
| **Maturity** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| **Learning Curve** | Easy | Medium | Medium |

---

## Final Recommendation

### **Use Arcjet as Primary Solution**

**Configuration:**

```typescript
// Install
npm install @arcjet/node @arcjet/nest

// Configure
import { ArcjetModule } from '@arcjet/nest';

@Module({
  imports: [
    ArcjetModule.forRoot({
      key: process.env.ARCJET_KEY!,
      rules: [
        shield({ mode: "LIVE" }),
        tokenBucket({
          mode: "LIVE",
          refillRate: 5,
          interval: 10,
          capacity: 10,
        }),
      ],
    }),
  ],
})
export class AppModule {}
```

**Supplementary Tools:**

- **Cloudflare Turnstile:** For high-risk operations (signup, password reset)
- **email-validator:** Client-side validation
- **disposable-email-domains:** Block temp emails
- **MailSlurp:** Enterprise email verification

---

## Next Steps

1. **Prototype Arcjet** in development environment
2. **Compare results** with @nestjs/throttler
3. **Update task** with Arcjet implementation
4. **Document decision** in ADR (Architecture Decision Record)

---

**Decision:** Recommend **Arcjet** over @nestjs/throttler for enterprise-grade security

**Rationale:** Better protection, more features, future-proof architecture
