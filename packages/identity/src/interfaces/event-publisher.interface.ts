import type { TenantProvisionedEvent } from "../events/tenant-provisioned.event.js";
import type { UserInvitedEvent } from "../events/user-invited.event.js";

export interface IIdentityEventPublisher {
  publishTenantProvisioned(event: TenantProvisionedEvent): Promise<void> | void;
  publishUserInvited(event: UserInvitedEvent): Promise<void> | void;
}
