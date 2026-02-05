import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSION_KEY,
  RequiredPermission,
} from './require-permission.decorator';
import { Request } from 'express';
import { User } from '@nexiom/identity';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<
      RequiredPermission[]
    >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions) {
      return true;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<Request & { user: User & { permissions: string[] } }>();

    if (!user) {
      this.logger.warn('User not found in request (AuthGuard missing?)');
      throw new UnauthorizedException('User not authenticated');
    }

    if (!user.permissions) {
      this.logger.warn(`User ${user.id} has no permissions loaded`);
      throw new ForbiddenException('User has no permissions assigned');
    }

    const hasPerm = requiredPermissions.some((required) =>
      this.hasPermission(user.permissions, required),
    );

    if (!hasPerm) {
      const requiredStrings = requiredPermissions
        .map((r) => `${r.resource}:${r.action}`)
        .join(', ');

      this.logger.warn(
        `Missing required permissions: [${requiredStrings}]. User has: [${user.permissions.join(', ')}]`,
      );

      throw new ForbiddenException('Missing required permissions');
    }

    return true;
  }

  private hasPermission(
    userPermissions: string[],
    required: RequiredPermission,
  ): boolean {
    // Platform Admin wildcard equivalent
    if (userPermissions.includes('*')) {
      return true;
    }

    // Exact Match: "users:manage"
    const permissionString = `${required.resource}:${required.action}`;

    // Check array
    return userPermissions.includes(permissionString);
  }
}
