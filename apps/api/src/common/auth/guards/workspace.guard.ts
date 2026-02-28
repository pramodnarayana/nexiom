import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Request } from 'express';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  workspaces,
} from '@nexiom/database';
import { member } from '@nexiom/identity';
import { eq, and } from 'drizzle-orm';
import { RequestAuthContext } from '@nexiom/auth';

export interface WorkspaceRequest extends Request {
  authContext?: RequestAuthContext;
  workspaceSchema?: string;
  workspaceId?: string;
}

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    const authContext = request.authContext;

    if (!authContext) {
      throw new ForbiddenException(
        'User must be authenticated to access this workspace.',
      );
    }

    const slug = (request.headers['x-workspace-slug'] ||
      request.query['workspaceSlug']) as string;
    if (!slug) {
      throw new BadRequestException(
        'x-workspace-slug header or workspaceSlug query parameter is missing.',
      );
    }

    // Lookup workspace by slug
    const workspace = await this.db.query.workspaces.findFirst({
      where: eq(workspaces.slug, slug),
    });

    if (!workspace) {
      throw new ForbiddenException('Invalid workspace slug.');
    }

    // Verify if user is a member of workspace.tenantId
    // identity.member table links user to organization (tenant).
    const access = await this.db
      .select()
      .from(member)
      .where(
        and(
          eq(member.userId, authContext.user.id),
          eq(member.organizationId, workspace.tenantId),
        ),
      )
      .limit(1);

    if (access.length === 0) {
      throw new ForbiddenException(
        'User does not have access to the tenant that owns this workspace.',
      );
    }

    // Inject schema name into request for data plane to use later!
    request.workspaceSchema = workspace.dbSchemaName;
    request.workspaceId = workspace.id;

    return true;
  }
}
