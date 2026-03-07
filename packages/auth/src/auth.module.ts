import { Module, Global, forwardRef } from "@nestjs/common";
import { AuthService } from "./services/auth.service.js";
import { AuthGuard } from "./guards/auth.guard.js";
import { PermissionsGuard } from "./guards/permissions.guard.js";
import { IdentityModule } from "@nexiom/identity";

@Global()
@Module({
  imports: [forwardRef(() => IdentityModule)],
  providers: [AuthService, AuthGuard, PermissionsGuard],
  exports: [AuthService, AuthGuard, PermissionsGuard],
})
export class AuthModule {}
