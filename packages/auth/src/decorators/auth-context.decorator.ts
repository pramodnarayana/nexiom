import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from "@nestjs/common";
import { User, Session } from "@nexiom/identity";
import { Request } from "express";

export interface RequestAuthContext {
  headers: Headers;
  user: User;
  session: Session;
}

declare module "express" {
  interface Request {
    authContext?: RequestAuthContext;
  }
}

export const AuthContext = createParamDecorator(
  (data: keyof RequestAuthContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const authContext = request.authContext;

    if (!authContext) {
      throw new InternalServerErrorException(
        "AuthContext is not available. Ensure an auth guard (AuthGuard, SystemAdminGuard, or PlatformGuard) is applied to this route.",
      );
    }

    return data ? authContext[data] : authContext;
  },
);
