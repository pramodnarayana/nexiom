import { Injectable, Inject } from '@nestjs/common';
import type {
  TriggerAppConnectionRepositoryPort,
  TriggerConnectionRecord,
} from '../../core/ports/outbound/trigger-app-connection-repository.port.js';
import { DATABASE_CONNECTION } from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';

interface RawConnectionRow {
  workspace_id: string;
  tenant_id: string;
  app_name: string;
  trigger_name: string;
  object_type: string | null;
  auth: unknown;
  props_value: Record<string, unknown>;
  webhook_secret: string | null;
  metadata: unknown;
}

@Injectable()
export class DrizzleTriggerAppConnectionAdapter implements TriggerAppConnectionRepositoryPort {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async findActiveConnection(
    dataSourceId: string,
  ): Promise<TriggerConnectionRecord | null> {
    const result = await this.db.$client.query<RawConnectionRow>(
      `SELECT
                ac.workspace_id,
                ac.tenant_id,
                ac.app_name,
                ac.trigger_name,
                ac.object_type,
                ac.encrypted_credentials AS auth,
                ac.props_value,
                ac.webhook_secret,
                ds.metadata
             FROM app_credential ac
             JOIN data_source ds ON ds.id = ac.data_source_id
             WHERE ac.data_source_id = $1
               AND ac.status = 'active'
             LIMIT 1`,
      [dataSourceId],
    );

    const row = result.rows[0];
    if (!row) return null;

    const appProfile =
      row.metadata &&
      typeof row.metadata === 'object' &&
      'appProfile' in row.metadata
        ? ((row.metadata as Record<string, unknown>).appProfile as string)
        : 'standard';

    return {
      workspaceId: row.workspace_id,
      tenantId: row.tenant_id,
      appName: row.app_name,
      triggerName: row.trigger_name,
      objectType: row.object_type ?? undefined,
      auth: row.auth,
      propsValue: row.props_value,
      webhookSecret: row.webhook_secret ?? undefined,
      appProfile,
    };
  }
}
