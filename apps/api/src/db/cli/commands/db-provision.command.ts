import { Command, CommandRunner, Option } from 'nest-commander';
import { DevSandboxProvisionerService } from '../../services/dev-sandbox-provisioner.service.js';
import { ConnectionSchemaProvisionerService } from '../../services/connection-schema-provisioner.service.js';

@Command({
  name: 'db:provision',
  description: 'Provisions local fixtures or schemas',
})
export class DbProvisionCommand extends CommandRunner {
  constructor(
    private readonly sandboxProvisioner: DevSandboxProvisionerService,
    private readonly schemaProvisioner: ConnectionSchemaProvisionerService,
  ) {
    super();
  }

  @Option({
    flags: '--local',
    description:
      'Provisions local dev data (Salesforce + QuickBooks connections)',
  })
  parseLocal() {
    return true;
  }

  @Option({
    flags: '--gateway',
    description: 'Upgrades a specific schema to GATEWAY_ACTIVE',
  })
  parseGateway() {
    return true;
  }

  @Option({
    flags: '--outbound',
    description: 'Upgrades a specific schema to OUTBOUND_ACTIVE',
  })
  parseOutbound() {
    return true;
  }

  @Option({
    flags: '-s, --schema [name]',
    description:
      'The physical schema name (e.g. ws_salesforce_abc123) for gateway/outbound commands',
  })
  parseSchemaName(val: string): string {
    return val;
  }

  async run(
    _passedParam: string[],
    options?: {
      local?: boolean;
      gateway?: boolean;
      outbound?: boolean;
      schema?: string;
    },
  ): Promise<void> {
    try {
      if (options?.local) {
        await this.sandboxProvisioner.provisionLocal();
      } else if (options?.gateway && options?.schema) {
        await this.schemaProvisioner.provisionGateway(options.schema);
      } else if (options?.outbound && options?.schema) {
        await this.schemaProvisioner.provisionOutbound(options.schema);
      } else {
        console.error(
          'Usage: db:provision --type <local|gateway|outbound> [--schema <schema>]',
        );
      }
    } catch (err) {
      console.error('Failed to provision database:', err);
      process.exit(1);
    }
  }
}
