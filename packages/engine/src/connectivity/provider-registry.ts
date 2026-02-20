import { Injectable, Inject } from '@nestjs/common';
import { providers } from '@nexiom/database';
import { eq, and } from 'drizzle-orm';

/**
 * Database-backed provider registry.
 * Replaces the former static ALLOWED_PROVIDERS Set with a queryable catalog
 * so providers can be added/disabled without code changes.
 */
@Injectable()
export class ProviderRegistryService {
    constructor(
        @Inject('DRIZZLE_DB') private readonly db: Record<string, any>,
    ) { }

    /** Check whether a provider exists and is enabled. */
    async isAllowed(name: string): Promise<boolean> {
        const row = await this.db
            .select({ name: providers.name })
            .from(providers)
            .where(and(eq(providers.name, name), eq(providers.enabled, true)))
            .limit(1);
        return row.length > 0;
    }

    /** Retrieve full provider configuration (returns null if not found). */
    async getProvider(name: string) {
        const rows = await this.db
            .select()
            .from(providers)
            .where(eq(providers.name, name))
            .limit(1);
        return rows[0] ?? null;
    }

    /** List all enabled providers. */
    async getAllProviders() {
        return this.db
            .select()
            .from(providers)
            .where(eq(providers.enabled, true));
    }
}
