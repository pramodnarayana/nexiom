import { SetMetadata } from "@nestjs/common";

export const PERMISSION_KEY = "permissions";

export interface RequiredPermission {
  resource: string;
  action: string;
}

export const RequirePermission = (resource: string, action: string) =>
  SetMetadata(PERMISSION_KEY, [{ resource, action }]);
