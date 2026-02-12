# Technical Debt

This document tracks known technical debt items that should be addressed in future sprints. Items are prioritized by impact and effort.

---

## High Priority

### 1. Permission Caching Architecture

**Location**: `apps/web/src/app/providers/auth-provider.ts`  
**Added**: 2026-02-12  
**Impact**: Performance, Scalability  
**Effort**: Medium (1-2 days)

**Current State**:

- `getPermissions()` makes a network call to `/api/users/me` on every invocation
- No caching mechanism in place
- Can result in 50+ API calls per user session for permission checks

**Recommended Solution**:
Adopt industry-standard data-fetching library (React Query or SWR):

- Automatic caching with configurable TTL
- Request deduplication
- Background refetching strategies
- Built-in devtools for debugging
- Observable cache metrics

**Enterprise Examples**:

- Stripe: React Query for all API state
- GitHub: Custom cache service with Redis
- Salesforce: Dedicated CacheService class

**Alternative**: Build custom cache service with:

- Dedicated `PermissionCacheService` class
- Environment-based configuration
- LRU eviction policy
- Cache warming on login
- Monitoring/observability hooks

**References**:

- [Permission Architecture Pattern](file:///.gemini/antigravity/brain/d18e0ee0-ce96-4db3-9e9a-041242a6c761/permission_architecture_pattern.md)

---

## Medium Priority

*No items currently tracked*

---

## Low Priority

*No items currently tracked*

---

## Completed Items

*Items resolved will be moved here with completion date*
