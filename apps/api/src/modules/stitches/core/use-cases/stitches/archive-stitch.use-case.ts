import { Injectable, Inject } from '@nestjs/common';
import {
  STITCH_REPOSITORY_PORT,
  type StitchRepositoryPort,
} from '../../ports/outbound/stitch-repository.port.js';

@Injectable()
export class ArchiveStitchUseCase {
  constructor(
    @Inject(STITCH_REPOSITORY_PORT)
    private readonly stitchRepo: StitchRepositoryPort,
  ) {}

  async execute(orgId: string, id: string) {
    return this.stitchRepo.archiveStitch(orgId, id);
  }
}
