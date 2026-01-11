import { Injectable } from '@nestjs/common';
import { IdentityProvider } from '../auth/identity-provider.abstract';

@Injectable()
export class TenantsService {
  constructor(private readonly identityProvider: IdentityProvider) {}

  async findAll(search?: string) {
    return this.identityProvider.listTenants(search);
  }

  async updateStatus(id: string, status: 'active' | 'disabled' | 'suspended') {
    return this.identityProvider.updateTenantStatus(id, status);
  }
}
