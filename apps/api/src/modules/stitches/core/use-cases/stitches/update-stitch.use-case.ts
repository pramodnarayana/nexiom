import { Injectable, Inject } from '@nestjs/common';
import {
  STITCH_REPOSITORY_PORT,
  type StitchRepositoryPort,
} from '../../ports/outbound/stitch-repository.port.js';
import { BadRequestException } from '@nestjs/common';
import type { UpdateStitch } from '../../../stitches.validation.js';

@Injectable()
export class UpdateStitchUseCase {
  constructor(
    @Inject(STITCH_REPOSITORY_PORT)
    private readonly stitchRepo: StitchRepositoryPort,
  ) {}

  async execute(orgId: string, id: string, params: UpdateStitch) {
    const hasChanges =
      params.name !== undefined ||
      params.status !== undefined ||
      params.syncCondition !== undefined;

    if (!hasChanges) {
      throw new BadRequestException('No updatable fields provided.');
    }

    return this.stitchRepo.updateStitch(orgId, id, params);
  }
}
