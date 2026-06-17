import { Injectable, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { fieldMappings } from "@soopa/database";
import { DB_MANAGER, type DatabaseManager } from "@soopa/dbmanager";
import { FieldMappingRepositoryPort } from '../../../shared/ports/field-mapping.repository.port.js';
import { Rule } from '../../../index.js';

@Injectable()
export class DrizzleFieldMappingRepositoryAdapter implements FieldMappingRepositoryPort {
  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async getMappingRules(
    tenantId: string,
    stitchId: string,
    canonicalType: string
  ): Promise<Rule[] | null> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    const mappings = await tenantDb
      .select()
      .from(fieldMappings)
      .where(
        sql`${fieldMappings.stitchId} = ${stitchId} AND ${fieldMappings.sourceCanonical} = ${canonicalType}`,
      )
      .limit(1);

    if (mappings.length === 0) {
      return null;
    }

    return mappings[0].mappingRules as Rule[];
  }
}
