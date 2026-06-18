import {
  Injectable,
  NotFoundException,
  Inject,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { eq, isNull, and } from 'drizzle-orm';
import { DB_MANAGER } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import { canonicalMappings } from '@soopa/database';
import { PinoLogger } from 'nestjs-pino';
import type { CreateMapping, UpdateMapping } from './mappings.validation.js';
import { DEFAULT_MAPPING_VERSION } from './mappings.constants.js';

@Injectable()
export class MappingsService {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {
    this.logger.setContext(MappingsService.name);
  }

  async findAll(tenantId: string) {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    return tenantDb
      .select()
      .from(canonicalMappings)
      .where(isNull(canonicalMappings.tenantId))
      .orderBy(canonicalMappings.createdAt);
  }

  async findOne(tenantId: string, id: string) {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    const records = await tenantDb
      .select()
      .from(canonicalMappings)
      .where(
        and(eq(canonicalMappings.id, id), isNull(canonicalMappings.tenantId)),
      )
      .limit(1);
    if (!records.length) {
      throw new NotFoundException(`Mapping with ID ${id} not found`);
    }
    return records[0];
  }

  async create(tenantId: string, payload: CreateMapping) {
    try {
      const tenantDb = await this.dbManager.getTenantDb(tenantId);
      const records = await tenantDb
        .insert(canonicalMappings)
        .values({
          tenantId: null, // In tenant DB, tenant_id should be NULL
          appName: payload.appName,
          category: payload.category,
          entity: payload.entity,
          viewMode: payload.viewMode,
          version:
            (payload.version?.trim() || DEFAULT_MAPPING_VERSION) ??
            DEFAULT_MAPPING_VERSION,
          mappingConfig: payload.mappingConfig,
        })
        .returning();

      return records[0];
    } catch (error: unknown) {
      const safePayload = {
        appName: payload.appName,
        category: payload.category,
        entity: payload.entity,
        viewMode: payload.viewMode,
      };
      this.logger.error(
        { err: error, payload: safePayload },
        'Failed to create Mapping configuration',
      );
      throw new BadRequestException('Failed to create Mapping');
    }
  }

  async update(tenantId: string, id: string, payload: UpdateMapping) {
    try {
      const tenantDb = await this.dbManager.getTenantDb(tenantId);
      const records = await tenantDb
        .update(canonicalMappings)
        .set({
          appName: payload.appName,
          category: payload.category,
          entity: payload.entity,
          viewMode: payload.viewMode,
          ...(payload.version && payload.version.trim() && { version: payload.version.trim() }),
          mappingConfig: payload.mappingConfig,
        })
        .where(
          and(eq(canonicalMappings.id, id), isNull(canonicalMappings.tenantId)),
        )
        .returning();

      if (records.length === 0) {
        throw new NotFoundException(`Mapping with ID ${id} not found`);
      }

      return records[0];
    } catch (error: unknown) {
      // Preserve HttpException subclasses (like NotFoundException)
      if (error instanceof HttpException) {
        throw error;
      }
      const safePayload = {
        appName: payload.appName,
        category: payload.category,
        entity: payload.entity,
        viewMode: payload.viewMode,
      };
      this.logger.error(
        { err: error, id, payload: safePayload },
        'Failed to update Mapping configuration',
      );
      throw new BadRequestException('Failed to update Mapping');
    }
  }

  async remove(tenantId: string, id: string) {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    await this.findOne(tenantId, id);

    await tenantDb
      .delete(canonicalMappings)
      .where(
        and(eq(canonicalMappings.id, id), isNull(canonicalMappings.tenantId)),
      );

    return { success: true };
  }
}
