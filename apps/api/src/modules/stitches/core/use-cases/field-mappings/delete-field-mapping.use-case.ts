import { Injectable, Inject } from '@nestjs/common';
import {
  FIELD_MAPPING_REPOSITORY_PORT,
  type FieldMappingRepositoryPort,
} from '../../ports/outbound/field-mapping-repository.port.js';

@Injectable()
export class DeleteFieldMappingUseCase {
  constructor(
    @Inject(FIELD_MAPPING_REPOSITORY_PORT)
    private readonly fieldMappingRepo: FieldMappingRepositoryPort,
  ) {}

  async execute(orgId: string, stitchId: string, sourceCanonical: string) {
    return this.fieldMappingRepo.deleteMapping(
      orgId,
      stitchId,
      sourceCanonical,
    );
  }
}
