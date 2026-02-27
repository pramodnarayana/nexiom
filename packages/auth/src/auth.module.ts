import { Module, Global } from "@nestjs/common";
import { AuthService } from "./services/auth.service";
import { AuthGuard } from "./guards/auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { IdentityModule } from "@nexiom/identity";

@Global()
@Module({
  imports: [IdentityModule],
  providers: [AuthService, AuthGuard, PermissionsGuard],
  exports: [AuthService, AuthGuard, PermissionsGuard],
})
export class AuthModule {}
