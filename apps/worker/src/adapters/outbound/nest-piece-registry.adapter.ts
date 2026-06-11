import { Injectable } from "@nestjs/common";
import { PluginManagerService } from "@soopa/piece-registry";
import axios from "axios";
import type { PieceRegistryPort } from "../../core/ports/outbound/app-installer-ports.js";

@Injectable()
export class NestPieceRegistryAdapter implements PieceRegistryPort {
  constructor(private readonly pluginManager: PluginManagerService) {}

  async installPiece(
    packageName: string,
    version: string,
  ): Promise<{ version: string }> {
    const pluginInfo = await this.pluginManager.installPiece(
      packageName,
      version,
    );
    return { version: pluginInfo.version };
  }

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await axios.get<{ version: string }>(
      `https://registry.npmjs.org/${packageName}/latest`,
      { timeout: 5000 },
    );
    return response.data.version;
  }
}
