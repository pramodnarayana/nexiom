import { Tenant } from "./types";

export interface ITenantProvider {
  create(userId: string, name: string): Promise<Tenant>;

  findAllForUser(userId: string): Promise<(Tenant & { memberRole?: string })[]>;

  findById(id: string): Promise<Tenant | null>;

  updateStatus(id: string, status: Tenant["status"]): Promise<Tenant>;

  // High-level orchestration
  provisionTenantForUser(userId: string): Promise<Tenant>;
}
