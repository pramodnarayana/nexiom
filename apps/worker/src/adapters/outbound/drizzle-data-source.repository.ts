import { Injectable, Inject } from "@nestjs/common";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  dataSources,
} from "@soopa/database";
import { eq } from "drizzle-orm";
import type {
  DataSourceRepositoryPort,
  DataSourceMetadata,
} from "../../core/ports/outbound/data-source-repository.port.js";

@Injectable()
export class DrizzleDataSourceRepositoryAdapter implements DataSourceRepositoryPort {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async getDataSourceMetadata(
    dataSourceId: string,
  ): Promise<DataSourceMetadata> {
    const connRows = await this.db
      .select()
      .from(dataSources)
      .where(eq(dataSources.id, dataSourceId))
      .limit(1);

    if (!connRows[0]) {
      throw new Error(`Data source ${dataSourceId} not found in dataSources`);
    }

    const connectionAppName = connRows[0].appName;
    const metadata = connRows[0].metadata as Record<string, unknown> | null;

    const trimmedAppProfile =
      typeof metadata?.appProfile === "string"
        ? metadata.appProfile.trim()
        : "";
    const appProfile =
      trimmedAppProfile !== "" ? trimmedAppProfile : "standard";

    return {
      appName: connectionAppName,
      appProfile,
    };
  }
}
