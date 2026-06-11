import { Injectable } from "@nestjs/common";
import { ApplicationLoaderService } from "@soopa/pipeline";
import type { CacheInvalidatorPort } from "../../core/ports/outbound/gitops-ports.js";

@Injectable()
export class NestCacheInvalidatorAdapter implements CacheInvalidatorPort {
  constructor(
    private readonly applicationLoaderService: ApplicationLoaderService,
  ) {}

  async invalidate(shardName: string): Promise<void> {
    this.applicationLoaderService.invalidateCache(shardName);
    await Promise.resolve();
  }
}
