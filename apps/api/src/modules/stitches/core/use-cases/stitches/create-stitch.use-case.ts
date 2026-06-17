import { Injectable, Inject } from '@nestjs/common';
import {
  STITCH_REPOSITORY_PORT,
  type StitchRepositoryPort,
} from '../../ports/outbound/stitch-repository.port.js';

import type { CreateStitch } from '../../../stitches.validation.js';

@Injectable()
export class CreateStitchUseCase {
  constructor(
    @Inject(STITCH_REPOSITORY_PORT)
    private readonly stitchRepo: StitchRepositoryPort,
  ) {}

  async execute(orgId: string, params: CreateStitch) {
    const { stitch } = await this.stitchRepo.createStitch(orgId, params);

    return stitch;
  }
}
