import { Injectable } from "@nestjs/common";
import type { CacheInvalidatorPort } from "../../core/ports/outbound/gitops-ports.js";

@Injectable()
export class NestCacheInvalidatorAdapter implements CacheInvalidatorPort {
  async invalidate(_shardName: string): Promise<void> {
    // Legacy application loader cache invalidation is no longer required.
    // Plugin hot-loading handles this automatically in dev.
    await Promise.resolve();
  }
}
