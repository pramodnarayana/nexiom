import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { IIdentityEventPublisher } from "../core/ports/outbound/index.js";
import type {
  TenantProvisionedEvent,
  UserInvitedEvent,
} from "../events/index.js";

@Injectable()
export class IdentityEventPublisher implements IIdentityEventPublisher {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  async publishTenantProvisioned(event: TenantProvisionedEvent): Promise<void> {
    await this.eventEmitter.emitAsync("tenant.provisioned", event);
  }

  async publishUserInvited(event: UserInvitedEvent): Promise<void> {
    await this.eventEmitter.emitAsync("user.invited", event);
  }
}
