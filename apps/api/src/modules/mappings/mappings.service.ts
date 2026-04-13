import {
  Injectable,
  NotFoundException,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE_CONNECTION, canonicalMappings } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';
import { PinoLogger } from 'nestjs-pino';
import type { CreateMapping, UpdateMapping } from './mappings.validation.js';

@Injectable()
export class MappingsService {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.logger.setContext(MappingsService.name);
  }

  async findAll() {
    return this.db
      .select()
      .from(canonicalMappings)
      .orderBy(canonicalMappings.createdAt);
  }

  async findOne(id: string) {
    const records = await this.db
      .select()
      .from(canonicalMappings)
      .where(eq(canonicalMappings.id, id))
      .limit(1);
    if (!records.length) {
      throw new NotFoundException(`Mapping with ID ${id} not found`);
    }
    return records[0];
  }

  async create(payload: CreateMapping) {
    try {
      const records = await this.db
        .insert(canonicalMappings)
        .values({
          appName: payload.appName,
          category: payload.category,
          entity: payload.entity,
          viewMode: payload.viewMode,
          tenantId: payload.tenantId ?? null,
          version: payload.version ?? 'v1',
          mappingConfig: payload.mappingConfig,
        })
        .returning();

      await this.invalidateCache(
        payload.appName,
        payload.category,
        payload.entity,
        payload.viewMode,
        payload.version ?? 'v1',
        payload.tenantId || null,
      );
      return records[0];
    } catch (error: unknown) {
      this.logger.error(
        { err: error, payload },
        'Failed to create Mapping configuration',
      );
      throw new BadRequestException(
        'Failed to create Mapping: ' + (error as Error).message,
      );
    }
  }

  async update(id: string, payload: UpdateMapping) {
    try {
      const records = await this.db
        .update(canonicalMappings)
        .set({
          appName: payload.appName,
          category: payload.category,
          entity: payload.entity,
          viewMode: payload.viewMode,
          tenantId: payload.tenantId,
          version: payload.version,
          mappingConfig: payload.mappingConfig,
        })
        .where(eq(canonicalMappings.id, id))
        .returning();

      if (records.length === 0) {
        throw new NotFoundException(`Mapping with ID ${id} not found`);
      }

      await this.invalidateCache(
        records[0].appName,
        records[0].category,
        records[0].entity,
        records[0].viewMode,
        records[0].version,
        records[0].tenantId || null,
      );

      return records[0];
    } catch (error: unknown) {
      this.logger.error(
        { err: error, id, payload },
        'Failed to update Mapping configuration',
      );
      throw new BadRequestException(
        'Failed to update Mapping: ' + (error as Error).message,
      );
    }
  }

  async remove(id: string) {
    const existing = await this.findOne(id);

    await this.db.delete(canonicalMappings).where(eq(canonicalMappings.id, id));

    await this.invalidateCache(
      existing.appName,
      existing.category,
      existing.entity,
      existing.viewMode,
      existing.version,
      existing.tenantId,
    );

    return { success: true };
  }

  private async invalidateCache(
    appName: string,
    category: string,
    entity: string,
    viewMode: string,
    version: string,
    tenantId: string | null,
  ) {
    // Invalidate the cache key used by the Orchestrator MappingService
    const tenantKey = tenantId ? `tenant:${tenantId}:` : `global:`;
    const cacheKey = `ai:canonical_mappings:${tenantKey}${appName}:${category}:${entity}:${viewMode}:${version}`;
    await this.redis.del(cacheKey);
    this.logger.debug({ cacheKey }, 'Invalidated mapping redis cache key');
  }
}
