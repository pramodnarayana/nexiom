import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { DATABASE_CONNECTION, canonicalMappings } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';

@Injectable()
export class MappingService {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {
    this.logger.setContext(MappingService.name);
  }

  /**
   * Fetches the appropriate mapping configuration for a given context.
   * Preferentially attempts to load a Tenant-override mapping. If none exists,
   * falls back to the Global (tenantId IS NULL) mapping config.
   */
  public async getMapping(
    appName: string,
    category: string,
    entity: string,
    viewMode: string,
    tenantId: string,
    version: string = 'v1'
  ): Promise<Record<string, unknown> | null> {
    
    // First: Look for tenant-specific override
    const tenantOverride = await this.db.select({ config: canonicalMappings.mappingConfig })
      .from(canonicalMappings)
      .where(
        and(
          eq(canonicalMappings.appName, appName),
          eq(canonicalMappings.category, category),
          eq(canonicalMappings.entity, entity),
          eq(canonicalMappings.viewMode, viewMode),
          eq(canonicalMappings.version, version),
          eq(canonicalMappings.tenantId, tenantId)
        )
      )
      .limit(1);

    if (tenantOverride.length > 0) {
      this.logger.debug({ appName, category, entity, viewMode }, 'Loaded Tenant-Specific Mapping Override');
      return tenantOverride[0].config as Record<string, unknown>;
    }

    // Second: Fallback to global default
    const globalDefault = await this.db.select({ config: canonicalMappings.mappingConfig })
      .from(canonicalMappings)
      .where(
        and(
          eq(canonicalMappings.appName, appName),
          eq(canonicalMappings.category, category),
          eq(canonicalMappings.entity, entity),
          eq(canonicalMappings.viewMode, viewMode),
          eq(canonicalMappings.version, version),
          isNull(canonicalMappings.tenantId)
        )
      )
      .limit(1);

    if (globalDefault.length > 0) {
      return globalDefault[0].config as Record<string, unknown>;
    }

    // --- TEMPORARY MOCK MAPPING FOR PHASE 1 TESTING ---
    // Only enabled in non-production environments and requires exact context match
    const isNonProdMockEnabled = process.env.NODE_ENV !== 'production';

    if (
      isNonProdMockEnabled &&
      appName === 'salesforce' &&
      entity === 'rtms__Load__c' &&
      category === 'TMS' &&
      viewMode === 'summary'
    ) {
      this.logger.debug(
        { appName, entity, category, viewMode, tenantId, version, mockEnabled: isNonProdMockEnabled },
        'Injecting Temporary Mock TMS Mapping for Phase 1 testing'
      );
      return {
        loadId: "rtms__Load__c.Id",
        number: "rtms__Load__c.Name",
        status: "rtms__Load__c.rtms__Load_Status__c",
        origin: "rtms__Load__c.rtms__Origin__c",
        destination: "rtms__Load__c.rtms__Destination__c",
        customerTotal: "rtms__Load__c.rtms__Customer_Quote_Total__c",
        carrierTotal: "rtms__Load__c.rtms__Carrier_Invoice_Total__c",
        stops: {
          type: "array",
          source: "relations.rtms__Stop__c|1:N.records",
          mapping: {
            id: "Id",
            sequence: "rtms__Stop_Number__c",
            location: "rtms__Location__c",
            type: "rtms__Stop_Type__c"
          }
        }
      };
    }
    // ----------------------------------------------------

    this.logger.warn({ appName, category, entity, viewMode, tenantId, version }, 'No canonical mapping configuration found.');
    return null;
  }
}