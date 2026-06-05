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
    flags: '-u, --user [identifier]',
    description: 'Check permissions for a specific user (by ID or Email)',
  })
  parseUser(val: string): string {
    return val;
  }

  @Option({
    flags: '-r, --role [roleName]',
    description: 'Debug RBAC permissions for a role',
  })
  parseRole(val: string): string {
    return val;
  }

  async run(
    _passedParam: string[],
    options?: { user?: string; role?: string },
  ): Promise<void> {
    try {
      if (options?.user) {
        await this.rbacInspectorService.checkUserPermissions(options.user);
      } else if (options?.role) {
        await this.rbacInspectorService.debugPermissions(options.role);
      } else {
        console.error(
          'Usage: db:debug [--user <userId|email>] [--role <roleName>]',
        );
      }
    } catch (err) {
      console.error('Failed to run debug command:', err);
      process.exit(1);
    }
  }
}
