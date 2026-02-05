import type { Tenant } from "./types";

export interface UpdateTenantInput {
  name?: string;
  slug?: string;
  logo?: string | null;
  status?: Tenant["status"];
  metadata?: Record<string, any>;
}

export interface ITenantProvider {
  // User-scoped creation (auto-adds member)
  create(userId: string, name: string): Promise<Tenant>;

  // Admin creation (pure tenant)
  createTenant(input: {
    name: string;
    slug: string;
    logo?: string | null;
  }): Promise<Tenant>;

  update(id: string, input: UpdateTenantInput): Promise<Tenant>;

  delete(id: string): Promise<void>;

  findAllForUser(userId: string): Promise<(Tenant & { memberRole?: string })[]>;

  findOneForUser(
    userId: string,
    tenantId?: string,
  ): Promise<(Tenant & { memberRole?: string }) | null>;

  findAll(options?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{ data: Tenant[]; total: number }>;

  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;

  updateStatus(id: string, status: Tenant["status"]): Promise<Tenant>;

  // High-level orchestration
  provisionTenantForUser(userId: string): Promise<Tenant>;
}
