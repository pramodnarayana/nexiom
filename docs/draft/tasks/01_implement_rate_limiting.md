# Task: Implement Rate Limiting

**Priority:** CRITICAL  
**Estimated Time:** 4-6 hours  
**Assignee:** Coder  
**Status:** Ready to Start

---

## Objective

Add comprehensive rate limiting to all API endpoints to prevent abuse and ensure system stability. This is the first task in Phase 1 of the Enterprise Refactor Plan.

---

## Why This Matters

**Security:** Prevent brute force attacks, credential stuffing, and API abuse  
**Stability:** Protect backend from being overwhelmed  
**Cost:** Reduce unnecessary database queries and API calls  
**Enterprise:** Required for production-grade APIs

---

## Libraries & Tools Required

### 1. Core Library

```bash
npm install @nestjs/throttler
```

**Why @nestjs/throttler:**

- ✅ Official NestJS package
- ✅ Integrates seamlessly with NestJS guards
- ✅ Supports multiple storage backends (memory, Redis)
- ✅ Configurable per-endpoint
- ✅ Well-documented

### 2. Redis Storage (Production)

```bash
npm install ioredis
npm install -D @types/ioredis
```

**Why Redis:**

- ✅ Distributed rate limiting (works across multiple servers)
- ✅ Fast in-memory storage
- ✅ Automatic key expiration
- ✅ Production-ready

### 3. Development Dependencies

```bash
npm install -D @nestjs/testing
```

Already installed, needed for testing.

---

## Implementation Steps

### Step 1: Install Dependencies

```bash
cd apps/api
npm install @nestjs/throttler ioredis
npm install -D @types/ioredis
```

### Step 2: Create Redis Client Configuration

**File:** `apps/api/src/config/redis.config.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  private client: Redis;

  constructor(private configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      db: this.configService.get('REDIS_DB', 0),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
```

### Step 3: Create Custom Throttler Storage

**File:** `apps/api/src/common/throttler/redis-throttler-storage.service.ts`

```typescript
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../../config/redis.config';

@Injectable()
export class RedisThrottlerStorageService
  implements ThrottlerStorage, OnApplicationShutdown
{
  private redis;
  private scriptSha: string;

  constructor(private redisService: RedisService) {
    this.redis = redisService.getClient();
  }

  async increment(key: string, ttl: number): Promise<{
    totalHits: number;
    timeToExpire: number;
  }> {
    const results = await this.redis
      .multi()
      .incr(key)
      .pttl(key)
      .exec();

    const totalHits = results[0][1];
    let timeToExpire = results[1][1];

    if (timeToExpire === -1) {
      await this.redis.pexpire(key, ttl);
      timeToExpire = ttl;
    }

    return { totalHits, timeToExpire };
  }

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
```

### Step 4: Configure Throttler Module

**File:** `apps/api/src/app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { RedisService } from './config/redis.config';
import { RedisThrottlerStorageService } from './common/throttler/redis-throttler-storage.service';

@Module({
  imports: [
    // ... other imports
    
    ThrottlerModule.forRootAsync({
      useFactory: (redisService: RedisService) => ({
        throttlers: [
          {
            name: 'short',
            ttl: 1000, // 1 second
            limit: 10, // 10 requests per second
          },
          {
            name: 'medium',
            ttl: 60000, // 1 minute  
            limit: 100, // 100 requests per minute
          },
          {
            name: 'long',
            ttl: 3600000, // 1 hour
            limit: 1000, // 1000 requests per hour
          },
        ],
        storage: new RedisThrottlerStorageService(redisService),
      }),
      inject: [RedisService],
    }),
  ],
  providers: [
    RedisService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard, // Apply globally
    },
  ],
})
export class AppModule {}
```

### Step 5: Apply Endpoint-Specific Limits

**File:** `apps/api/src/modules/auth/auth.controller.ts`

```typescript
import { Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  
  // Strict limit on signup (prevent spam accounts)
  @Post('signup')
  @Throttle({ short: { limit: 3, ttl: 60000 } }) // 3 per minute
  @Throttle({ long: { limit: 10, ttl: 3600000 } }) // 10 per hour
  async signup(@Body() dto: SignUpDto) {
    return this.authService.signup(dto);
  }

  // Strict limit on login (prevent brute force)
  @Post('login')
  @Throttle({ short: { limit: 5, ttl: 60000 } }) // 5 per minute
  @Throttle({ long: { limit: 20, ttl: 3600000 } }) // 20 per hour
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Moderate limit on logout
  @Post('logout')
  @Throttle({ medium: { limit: 10, ttl: 60000 } }) // 10 per minute
  async logout() {
    return this.authService.logout();
  }

  // Skip throttling for health checks
  @Get('health')
  @SkipThrottle()
  async health() {
    return { status: 'ok' };
  }
}
```

**File:** `apps/api/src/modules/users/users.controller.ts`

```typescript
@Controller('users')
export class UsersController {
  
  // Standard limit for list operations
  @Get()
  @Throttle({ medium: { limit: 60, ttl: 60000 } }) // 60 per minute
  async list() {
    return this.usersService.list();
  }

  // Standard limit for create
  @Post()
  @Throttle({ medium: { limit: 20, ttl: 60000 } }) // 20 per minute
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }
}
```

**File:** `apps/api/src/modules/invitations/invitations.controller.ts`

```typescript
@Controller('invitations')
export class InvitationsController {
  
  // Moderate limit on sending invitations
  @Post()
  @Throttle({ medium: { limit: 20, ttl: 3600000 } }) // 20 per hour
  async create(@Body() dto: CreateInvitationDto) {
    return this.invitationsService.create(dto);
  }
}
```

### Step 6: Add Rate Limit Headers

**File:** `apps/api/src/common/interceptors/rate-limit-headers.interceptor.ts`

```typescript
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class RateLimitHeadersInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const response = context.switchToHttp().getResponse();
    
    return next.handle().pipe(
      tap(() => {
        // Add rate limit info to headers
        // These will be populated by ThrottlerGuard
        const rateLimit = response.locals?.rateLimit;
        
        if (rateLimit) {
          response.setHeader('X-RateLimit-Limit', rateLimit.limit);
          response.setHeader('X-RateLimit-Remaining', rateLimit.remaining);
          response.setHeader('X-RateLimit-Reset', rateLimit.reset);
        }
      }),
    );
  }
}
```

Apply globally in `app.module.ts`:

```typescript
{
  provide: APP_INTERCEPTOR,
  useClass: RateLimitHeadersInterceptor,
}
```

### Step 7: Environment Variables

**File:** `apps/api/.env.example`

```bash
# Redis Configuration (for rate limiting)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

**File:** `apps/api/.env`

Add the same variables with actual values.

### Step 8: Write Tests

**File:** `apps/api/src/common/throttler/throttler.e2e.spec.ts`

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';

describe('Rate Limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/signup', () => {
    it('should enforce rate limit (3 per minute)', async () => {
      const email = `test-${Date.now()}@example.com`;
      
      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/auth/signup')
          .send({ 
            email: `${i}-${email}`, 
            password: 'Password123!',
            name: 'Test User'
          })
          .expect((res) => {
            expect(res.status).toBeLessThan(500);
          });
      }

      // 4th request should be rate limited
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ 
          email: `extra-${email}`, 
          password: 'Password123!',
          name: 'Test User'
        })
        .expect(429);
    });
  });

  describe('Rate Limit Headers', () => {
    it('should include rate limit headers in response', async () => {
      const response = await request(app.getHttpServer())
        .get('/users')
        .expect(200);

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });
  });
});
```

---

## Acceptance Criteria

### Functional Requirements

- [ ] Rate limiting is active on all endpoints
- [ ] Exceeding limit returns HTTP 429 (Too Many Requests)
- [ ] Rate limits are configurable per endpoint
- [ ] Health check endpoints bypass rate limiting
- [ ] Rate limit counters persist across server restarts (Redis)

### Rate Limits Configured

- [ ] Auth signup: 3/minute, 10/hour
- [ ] Auth login: 5/minute, 20/hour
- [ ] Invitation create: 20/hour
- [ ] User create: 20/minute
- [ ] User list: 60/minute
- [ ] Default endpoints: 100/minute, 1000/hour

### Testing

- [ ] E2E test verifies rate limiting works
- [ ] Test verifies 429 response after limit exceeded
- [ ] Test verifies rate limit headers in response
- [ ] Manual test with multiple requests confirms limits

### Documentation

- [ ] Environment variables documented in .env.example
- [ ] Rate limits documented in API docs (future Swagger)
- [ ] README updated with Redis requirement

---

## Success Metrics

**Before:**

- ❌ No rate limiting
- ❌ Vulnerable to abuse
- ❌ No protection from DDoS

**After:**

- ✅ All endpoints protected
- ✅ Configurable per endpoint
- ✅ Distributed (Redis-backed)
- ✅ Rate limit headers exposed
- ✅ Tests passing

---

## Troubleshooting

### Common Issues

**Issue:** Redis connection failed  
**Solution:** Ensure Redis is running (`docker run -d -p 6379:6379 redis`)

**Issue:** Rate limits not working  
**Solution:** Check ThrottlerGuard is registered as APP_GUARD

**Issue:** All requests getting 429  
**Solution:** Check ttl values are in milliseconds (not seconds)

**Issue:** Tests failing intermittently  
**Solution:** Clear Redis between tests or use separate DB number

---

## References

- [@nestjs/throttler Documentation](https://docs.nestjs.com/security/rate-limiting)
- [OWASP Rate Limiting Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html)
- [Redis Documentation](https://redis.io/docs/)

---

## Next Task

After this task is complete, the next task will be:
**Task 2: Implement Input Sanitization & XSS Prevention**

---

**Status:** Ready for implementation  
**Estimated Completion:** 1 day
