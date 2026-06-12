import { Injectable, Inject } from '@nestjs/common';
import {
  FIELD_MAPPING_REPOSITORY_PORT,
  type FieldMappingRepositoryPort,
} from '../../ports/outbound/field-mapping-repository.port.js';
import type { BulkUpsertAndDeleteBody } from '../../../field-mappings.validation.js';

@Injectable()
export class BulkUpsertAndDeleteFieldMappingsUseCase {
  constructor(
    @Inject(FIELD_MAPPING_REPOSITORY_PORT)
    private readonly fieldMappingRepo: FieldMappingRepositoryPort,
  ) {}

  async execute(
    orgId: string,
    stitchId: string,
    params: BulkUpsertAndDeleteBody,
  ) {
    return this.fieldMappingRepo.bulkUpsertAndDelete(orgId, stitchId, params);
  }
}
