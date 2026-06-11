import { Injectable, Inject } from '@nestjs/common';
import {
  STITCH_REPOSITORY_PORT,
  type StitchRepositoryPort,
} from '../../ports/outbound/stitch-repository.port.js';
import {
  SCHEMA_PROVISIONER_PORT,
  type SchemaProvisionerPort,
} from '../../ports/outbound/schema-provisioner.port.js';
import type { CreateStitch } from '../../../stitches.validation.js';

@Injectable()
export class CreateStitchUseCase {
  constructor(
    @Inject(STITCH_REPOSITORY_PORT)
    private readonly stitchRepo: StitchRepositoryPort,
    @Inject(SCHEMA_PROVISIONER_PORT)
    private readonly schemaProvisioner: SchemaProvisionerPort,
  ) {}

  async execute(orgId: string, params: CreateStitch) {
    const { stitch, destConnAppName, destAppProfile } =
      await this.stitchRepo.createStitch(orgId, params);

    await this.schemaProvisioner.provisionStitchSchemas(
      orgId,
      params.destDataSourceId,
      destConnAppName,
      destAppProfile,
    );

    return stitch;
  }
}
