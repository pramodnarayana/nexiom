# Task: Implement Enterprise Security Layer

**Priority:** CRITICAL  
**Estimated Time:** 6-8 hours  
**Assignee:** Coder  
**Status:** Ready to Start

---

## Objective

Implement a comprehensive security layer covering rate limiting (protection from abuse), bot detection (protection from bad actors), and input validation (protection from bad data). This is the first step in the Enterprise Refactor Plan.

---

## Why This Matters

**Security:** Prevent brute force attacks, credential stuffing, and botnets  
**Stability:** Protect backend from being overwhelmed (DDoS)  
**Quality:** Ensure only valid data enters the system  
**Open Source:** Using 100% open source, self-hostable tools

---

## The Tech Stack

1. **Rate Limiting:** `rate-limiter-flexible` + Redis
   - Why: Best-in-class token bucket algorithm, distributed, no vendor lock-in
2. **Bot Protection:** `CrowdSec` (@crowdsec/express-bouncer)
   - Why: Collaborative threat intelligence, blocks known bad IPs automatically
3. **Input Validation:** `class-validator` + `class-transformer`
   - Why: Standard NestJS validation, type-safe DTOs

---

## Implementation Steps

### Step 1: Install Dependencies

```bash
cd apps/api
npm install rate-limiter-flexible ioredis @crowdsec/express-bouncer class-validator class-transformer
npm install -D @types/ioredis
```

### Step 2: Configure CrowdSec (Layer 1)

**File:** `apps/api/src/common/middleware/crowdsec.middleware.ts`

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { ExpressCrowdsecMiddleware } from '@crowdsec/express-bouncer';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class CrowdSecMiddleware implements NestMiddleware {
  private bouncer: any;

  constructor() {
    this.bouncer = ExpressCrowdsecMiddleware({
      url: process.env.CROWDSEC_LAPI_URL || 'http://localhost:8080',
      apiKey: process.env.CROWDSEC_BOUNCER_KEY,
      updateIntervalMs: 10000,
      fallbackRemediation: 'captcha',
    });
  }

  use(req: Request, res: Response, next: NextFunction) {
    this.bouncer(req, res, next);
  }
}
```

Apply globally in `app.module.ts`:

```typescript
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CrowdSecMiddleware).forRoutes('*');
  }
}
```

### Step 3: Implement Rate Limiting (Layer 2)

**File:** `apps/api/src/common/guards/rate-limit.guard.ts`

```typescript
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private limiters: Map<string, RateLimiterRedis> = new Map();
  private redisClient: Redis;

  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const endpoint = request.route.path;
    const ip = request.ip;
    
    // Get custom limits from decorator or use default
    // Default: 100 requests per minute
    const limit = this.reflector.get<number>('rateLimit', context.getHandler()) || 100;
    const duration = this.reflector.get<number>('rateDuration', context.getHandler()) || 60;

    const keyPrefix = `rl:${endpoint}:`;
    
    let limiter = this.limiters.get(keyPrefix);
    if (!limiter) {
      limiter = new RateLimiterRedis({
        storeClient: this.redisClient,
        keyPrefix: keyPrefix,
        points: limit,
        duration: duration,
        blockDuration: 60 * 15, // Block for 15 mins if exceeded
      });
      this.limiters.set(keyPrefix, limiter);
    }

    try {
      await limiter.consume(ip);
      
      // Add headers
      const res = limiter.getRes(ip);
      const response = context.switchToHttp().getResponse();
      response.header('Retry-After', Math.ceil(res.msBeforeNext / 1000));
      response.header('X-RateLimit-Limit', limit);
      response.header('X-RateLimit-Remaining', res.remainingPoints);
      
      return true;
    } catch (rejRes) {
      if (rejRes instanceof Error) throw rejRes;
      
      const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Too many requests. Try again in ${secs} seconds.`,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
```

### Step 4: Configure Input Validation (Layer 3)

**File:** `main.ts`

```typescript
app.useGlobalPipes(new ValidationPipe({
  whitelist: true, // Strip properties not in DTO
  forbidNonWhitelisted: true, // Error if extra properties sent
  transform: true, // Auto-transform payloads to DTO instances
}));
```

**Example DTO:** `apps/api/src/modules/auth/dto/signup.dto.ts`

```typescript
import { IsEmail, IsString, IsStrongPassword, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  name: string;
  
  @IsStrongPassword()
  password: string;
}
```

### Step 5: Environment Variables

**File:** `apps/api/.env.example`

```bash
# Redis Configuration (Rate Limiting)
REDIS_HOST=localhost
REDIS_PORT=6379

# CrowdSec Configuration (Bot Protection)
CROWDSEC_LAPI_URL=http://localhost:8080
CROWDSEC_BOUNCER_KEY= # Get this via `cscli bouncers add nestjs-api`
```

---

## Acceptance Criteria

### Security

- [ ] CrowdSec middleware blocks known bad IPs (test with blocked IP)
- [ ] Rate limiting enforces limits per IP/Endpoint
- [ ] Redis stores rate limit counters
- [ ] Input validation rejects invalid data (strip extra fields)

### Specific Rate Limits

- [ ] `POST /auth/login`: 5 requests per minute
- [ ] `POST /auth/signup`: 3 requests per hour
- [ ] `POST /invitations`: 20 requests per hour
- [ ] Default: 100 requests per minute

### Testing

- [ ] E2E test verifying 403 Forbidden for bad IP (mock CrowdSec)
- [ ] E2E test verifying 429 Too Many Requests when limit exceeded
- [ ] E2E test verifying 400 Bad Request for invalid input

---

## Troubleshooting

**Issue:** CrowdSec middleware blocking everything  
**Solution:** Ensure `CROWDSEC_LAPI_URL` is reachable and `CROWDSEC_BOUNCER_KEY` is valid.

**Issue:** Rate limit not persisting  
**Solution:** Ensure Redis is persistent (AOF enabled).

---

**Status:** Ready to Start  
**Next Task:** Task 02 - Session Hardening & CSRF
