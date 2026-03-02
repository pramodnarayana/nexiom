import { Injectable } from '@nestjs/common';
import { PROVIDER_REGISTRY, type ProviderName } from './providers/index.js';
import type { ProviderDefinition } from './types.js';

/**
 * Code-first provider registry.
 * Provider definitions live in packages/connections/src/oauth/providers/
 * — no database queries required. Add new providers to PROVIDER_REGISTRY.
 */
@Injectable()
export class ProviderRegistryService {
    /** Check whether a provider exists and is enabled. */
    isAllowed(name: string): boolean {
        return Object.hasOwn(PROVIDER_REGISTRY, name);
    }

    /** Retrieve full provider configuration (returns null if not found). */
    getProvider(name: string): ProviderDefinition | null {
        if (!this.isAllowed(name)) return null;
        return PROVIDER_REGISTRY[name as ProviderName];
    }

    /** List all registered providers. */
    getAllProviders(): ProviderDefinition[] {
        return Object.values(PROVIDER_REGISTRY);
    }
}
