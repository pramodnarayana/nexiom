import { Injectable, Logger, Inject } from "@nestjs/common";
import { GlobalEntityMapRepositoryPort, GemMappingParams } from "../shared/ports/global-entity-map.repository.port.js";

@Injectable()
export class GemHydrationService {
  private readonly logger = new Logger(GemHydrationService.name);

  constructor(
    @Inject("GlobalEntityMapRepositoryPort")
    private readonly gemRepository: GlobalEntityMapRepositoryPort,
  ) {}

  async writeGemMapping(
    tenantId: string,
    params: GemMappingParams,
  ): Promise<void> {
    await this.gemRepository.writeGemMapping(tenantId, params);

    this.logger.log(
      {
        event: "gem.mapped",
        traceId: params.traceId,
        routeId: params.routeId,
        sourceAppName: params.srcAppName,
        sourceEntityId: params.srcVendorId,
        destAppName: params.targetAppName,
        destEntityId: params.destVendorId,
      },
      `Successfully wrote GEM linkage: ${params.srcAppName}[${params.srcVendorId}] -> ${params.targetAppName}[${params.destVendorId}]`,
    );
  }
}
