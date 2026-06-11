import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { canonicalMappings, DATABASE_CONNECTION, type DrizzleDb } from '@soopa/database';
import { DB_MANAGER, type DatabaseManager } from '@soopa/dbmanager';

@Injectable()
export class MappingService {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
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
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    // Look for mapping config in the tenant's dedicated database
    // Filter on tenant_id IS NULL to get tenant-specific mappings in tenant DB
    const mappingRecord = await tenantDb.select({ config: canonicalMappings.mappingConfig })
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

    if (mappingRecord.length > 0) {
      this.logger.debug({ appName, category, entity, viewMode }, 'Loaded Tenant Mapping Configuration');
      return mappingRecord[0].config as Record<string, unknown>;
    }

    // If no tenant-specific mapping found, fall back to global canonical mapping
    // In global DB, query both tenant-specific (tenant_id = tenantId) and global (tenant_id IS NULL)
    // Order by tenant_id DESC NULLS LAST to prefer tenant-specific rows
    const globalMappingRecord = await this.globalDb.select({ config: canonicalMappings.mappingConfig })
      .from(canonicalMappings)
      .where(
        and(
          eq(canonicalMappings.appName, appName),
          eq(canonicalMappings.category, category),
          eq(canonicalMappings.entity, entity),
          eq(canonicalMappings.viewMode, viewMode),
          eq(canonicalMappings.version, version)
        )
      )
      .orderBy(desc(canonicalMappings.tenantId))
      .limit(1);

    if (globalMappingRecord.length > 0) {
      this.logger.debug({ appName, category, entity, viewMode }, 'Loaded Global Mapping Configuration');
      return globalMappingRecord[0].config as Record<string, unknown>;
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