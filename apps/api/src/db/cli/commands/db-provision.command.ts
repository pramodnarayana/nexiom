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
    flags: '-s, --schema <name>',
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
      // Count how many mode flags are set
      const flagCount = [
        options?.local,
        options?.gateway,
        options?.outbound,
      ].filter(Boolean).length;

      // Validate exactly one mode flag is set
      if (flagCount === 0) {
        console.error(
          'Error: Must specify exactly one provisioning mode (--local, --gateway, or --outbound)',
        );
        console.error(
          'Usage: db:provision --local | --gateway --schema <schema> | --outbound --schema <schema>',
        );
        process.exit(1);
      }

      if (flagCount > 1) {
        console.error(
          'Error: Cannot specify multiple provisioning modes simultaneously',
        );
        console.error(
          'Usage: db:provision --local | --gateway --schema <schema> | --outbound --schema <schema>',
        );
        process.exit(1);
      }

      // Validate schema is required for gateway and outbound
      if (options?.gateway || options?.outbound) {
        if (!options?.schema) {
          console.error(
            'Error: --schema <schema> is required when using --gateway or --outbound',
          );
          console.error(
            'Usage: db:provision --local | --gateway --schema <schema> | --outbound --schema <schema>',
          );
          process.exit(1);
        }
      }

      // Execute the appropriate provisioner
      if (options?.local) {
        await this.sandboxProvisioner.provisionLocal();
      } else if (options?.gateway && options?.schema) {
        await this.schemaProvisioner.provisionGateway(options.schema);
      } else if (options?.outbound && options?.schema) {
        await this.schemaProvisioner.provisionOutbound(options.schema);
      }
    } catch (err) {
      console.error('Failed to provision database:', err);
      process.exit(1);
    }
  }
}
