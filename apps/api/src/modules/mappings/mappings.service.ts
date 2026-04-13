import {
  Injectable,
  NotFoundException,
  Inject,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE_CONNECTION, canonicalMappings } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { PinoLogger } from 'nestjs-pino';
import type { CreateMapping, UpdateMapping } from './mappings.validation.js';

@Injectable()
export class MappingsService {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
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
          tenantId: (payload.tenantId?.trim() || null) ?? null,
          version: (payload.version?.trim() || 'v1') ?? 'v1',
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
          tenantId: payload.tenantId?.trim() || null,
          version: payload.version?.trim() || 'v1',
          mappingConfig: payload.mappingConfig,
        })
        .where(eq(canonicalMappings.id, id))
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
      throw new BadRequestException(
        'Failed to update Mapping: ' + (error as Error).message,
      );
    }
  }

  async remove(id: string) {
    const existing = await this.findOne(id);

    await this.db.delete(canonicalMappings).where(eq(canonicalMappings.id, id));

    return { success: true };
  }
}