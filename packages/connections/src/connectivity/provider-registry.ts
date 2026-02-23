import { Injectable } from '@nestjs/common';
import { PROVIDER_REGISTRY } from './providers/index.js';
import type { ProviderDefinition } from './types.js';

/**
 * Code-first provider registry.
 * Provider definitions live in packages/connections/src/connectivity/providers/
 * — no database queries required. Add new providers to PROVIDER_REGISTRY.
 */
@Injectable()
export class ProviderRegistryService {
    /** Check whether a provider exists and is enabled. */
    isAllowed(name: string): boolean {
        return name in PROVIDER_REGISTRY;
    }

    /** Retrieve full provider configuration (returns null if not found). */
    getProvider(name: string): ProviderDefinition | null {
        return PROVIDER_REGISTRY[name] ?? null;
    }

    /** List all registered providers. */
    getAllProviders(): ProviderDefinition[] {
        return Object.values(PROVIDER_REGISTRY);
    }
}
