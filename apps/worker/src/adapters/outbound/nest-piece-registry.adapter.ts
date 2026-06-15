import { Injectable } from "@nestjs/common";
import { PluginManagerService } from "@soopa/piece-registry";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import type { PieceRegistryPort } from "../../core/ports/outbound/app-installer-ports.js";

@Injectable()
export class NestPieceRegistryAdapter implements PieceRegistryPort {
  constructor(
    private readonly pluginManager: PluginManagerService,
    private readonly configService: ConfigService,
  ) {}

  async installPiece(
    packageName: string,
    version: string,
  ): Promise<{
    version: string;
    location: string;
    moduleExports: Record<string, unknown>;
  }> {
    return await this.pluginManager.installPiece(packageName, version);
  }

  async getLatestVersion(packageName: string): Promise<string> {
    const registryUrl =
      this.configService.get<string>("NPM_REGISTRY_URL") ||
      "https://registry.npmjs.org/";
    const baseUrl = registryUrl.endsWith("/")
      ? registryUrl.slice(0, -1)
      : registryUrl;

    const response = await axios.get<{ version: string }>(
      `${baseUrl}/${packageName}/latest`,
      { timeout: 5000 },
    );
    return response.data.version;
  }
}
