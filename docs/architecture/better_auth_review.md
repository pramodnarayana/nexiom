# Architecture Review: Better Auth Integration Issues

## The Problem You're Experiencing

You're correct - this is **NOT enterprise-grade**. We keep fixing the same issue in different places:

1. Tenant invitation creation
2. System invitation creation  
3. (Likely more places to come...)

## Root Cause: Leaky Abstraction

**Better Auth's organization plugin** leaks implementation details throughout your codebase:

- Requires `headers` parameter for auth context
- Requires `organizationId` for tenant context
- Validates organization membership internally
- Throws cryptic errors (`VALIDATION_ERROR`, `UNAUTHORIZED`)

**Every controller must:**

1. Extract headers from request
2. Convert to Better Auth's `Headers` format
3. Remember to pass them everywhere
4. Handle Better Auth-specific errors

**This violates**:

- **DRY** (Don't Repeat Yourself)
- **Single Responsibility Principle**
- **Dependency Inversion** (controllers depend on Better Auth internals)

## Why This Isn't Enterprise-Grade

### 1. **Fragile** - Easy to forget headers

```typescript
// ❌ Missed headers = runtime error
await this.authProvider.createInvitation({
  email, role, organizationId, inviterId
  // Forgot headers!
});
```

### 2. **Not Type-Safe** - No compile-time checks

```typescript
// ✅ Compiles fine, ❌ fails at runtime
createInvitation(params: CreateInvitationInput)  // headers is optional in type
```

### 3. **Scattered Logic** - Headers conversion everywhere

```typescript
// Every controller duplicates this:
const webHeaders = new Headers();
Object.entries(headers).forEach(([key, value]) => {
  if (value) webHeaders.append(key, value);
});
```

### 4. **Poor Developer Experience** - Requires tribal knowledge

- "Remember to always pass headers"
- "Convert to WebHeaders first"
- "System invitations need system tenant ID"

## Enterprise-Grade Solutions

### Option A: Middleware + Context (Recommended)

**Pattern**: Extract auth context once, inject everywhere

```typescript
// middleware/auth-context.middleware.ts
@Injectable()
export class AuthContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Extract once, store in request
    req.authContext = {
      headers: this.toWebHeaders(req.headers),
      sessionId: req.cookies.session,
      organizationId: this.extractOrgId(req),
    };
    next();
  }
}

// controllers (clean!)
@Post('invitations')
async createInvitation(@Body() body, @AuthContext() ctx) {
  return this.authProvider.createInvitation({
    ...body,
    context: ctx  // Automatically includes headers, org, etc.
  });
}
```

**Benefits**:
✅ Headers extracted once  
✅ Type-safe context injection  
✅ No boilerplate in controllers  
✅ Testable (mock context)  

### Option B: Wrapper Service Layer

**Pattern**: Hide Better Auth complexity behind your own service

```typescript
// services/invitation.service.ts
@Injectable()
export class InvitationService {
  constructor(private betterAuth: BetterAuthAdapter) {}
  
  async createInvitation(
    dto: CreateInvitationDto,
    requestContext: RequestContext  // Your own type
  ) {
    // Handle all Better Auth quirks here
    const headers = this.prepareHeaders(requestContext);
    const orgId = this.resolveOrgId(dto, requestContext);
    
    return this.betterAuth.createInvitation({
      ...dto,
      headers,
      organizationId: orgId,
    });
  }
}

// Controllers become simple
@Post('invitations')
async create(@Body() dto, @Req() req) {
  return this.invitationService.createInvitation(dto, req.context);
}
```

**Benefits**:
✅ Single point of integration with Better Auth  
✅ Easy to swap auth providers  
✅ Centralized error handling  
✅ Controllers stay clean  

### Option C: Replace Better Auth Organization Plugin

**Pattern**: Implement your own organization checks

```typescript
// guards/organization-access.guard.ts
@Injectable()
export class OrganizationAccessGuard {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    const targetOrg = req.body.organizationId || req.params.orgId;
    
    // Your own logic, no Better Auth dependency
    return this.memberService.isMemberOf(user.id, targetOrg);
  }
}
```

**Benefits**:
✅ Full control over authorization  
✅ No Better Auth quirks  
✅ Simpler mental model  
✅ Better error messages  

## Immediate Action Items

### 1. **Quick Fix** (Done below)

Add headers to system invitation creation

### 2. **Short-term** (This Sprint)

Create wrapper service to centralize Better Auth calls

### 3. **Medium-term** (Next Quarter)

Evaluate replacing Better Auth organization plugin with custom solution

### 4. **Documentation**

Document "Always pass headers to Better Auth" in developer guide

## Comparison: Current vs. Enterprise

| Aspect | Current | Enterprise |
|--------|---------|------------|
| Headers handling | Manual, scattered | Middleware, automatic |
| Type safety | Runtime errors | Compile-time checks |
| Testability | Hard (needs headers) | Easy (mock context) |
| Error messages | Better Auth codes | Business-friendly |
| Coupling | High (to Better Auth) | Low (own abstractions) |
| New developer onboarding | Requires tribal knowledge | Self-documenting |

## Decision Required

Which approach do you prefer?

- **Option A**: Middleware + Context (Best practices, medium effort)
- **Option B**: Wrapper Service (Good balance, lower effort)  
- **Option C**: Replace Better Auth plugin (Most control, highest effort)

I recommend **Option B** for next sprint to stop the bleeding, then evaluate Option C long-term.
