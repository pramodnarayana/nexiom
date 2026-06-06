import { Command, CommandRunner, Option } from 'nest-commander';
import { RbacInspectorService } from '../../services/rbac-inspector.service.js';

@Command({
  name: 'db:debug',
  description: 'Debugs RBAC permissions for a role or user',
})
export class DbDebugCommand extends CommandRunner {
  constructor(private readonly rbacInspectorService: RbacInspectorService) {
    super();
  }

  @Option({
    flags: '-u, --user <identifier>',
    description: 'Check permissions for a specific user (by ID or Email)',
  })
  parseUser(val: string): string {
    return val;
  }

  @Option({
    flags: '-r, --role <roleName>',
    description: 'Debug RBAC permissions for a role',
  })
  parseRole(val: string): string {
    return val;
  }

  async run(
    _passedParam: string[],
    options?: { user?: string | boolean; role?: string | boolean },
  ): Promise<void> {
    try {
      // Enforce mutual exclusivity
      if (options?.user && options?.role) {
        console.error(
          'Error: Cannot specify both --user and --role options simultaneously',
        );
        console.error(
          'Usage: db:debug --user <userId|email> | --role <roleName>',
        );
        process.exit(1);
      }

      // Validate and execute user check
      if (options?.user) {
        if (typeof options.user !== 'string' || options.user === '') {
          console.error('Error: --user requires a valid string identifier');
          console.error(
            'Usage: db:debug --user <userId|email> | --role <roleName>',
          );
          process.exit(1);
        }
        await this.rbacInspectorService.checkUserPermissions(options.user);
      } else if (options?.role) {
        // Validate and execute role check
        if (typeof options.role !== 'string' || options.role === '') {
          console.error('Error: --role requires a valid string role name');
          console.error(
            'Usage: db:debug --user <userId|email> | --role <roleName>',
          );
          process.exit(1);
        }
        await this.rbacInspectorService.debugPermissions(options.role);
      } else {
        console.error('Error: Must specify either --user or --role option');
        console.error(
          'Usage: db:debug --user <userId|email> | --role <roleName>',
        );
        process.exit(1);
      }
    } catch (err) {
      console.error('Failed to run debug command:', err);
      process.exit(1);
    }
  }
}
