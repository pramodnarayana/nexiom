import { Test, TestingModule } from "@nestjs/testing";
import { IdentityEventPublisher } from "./identity-event-publisher.service.js";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { TenantProvisionedEvent, UserInvitedEvent } from "../events/index.js";
import { describe, it, expect, beforeEach, vi, Mock } from "vitest";

describe("IdentityEventPublisher", () => {
  let service: IdentityEventPublisher;

  let emitAsyncMock: Mock;

  beforeEach(async () => {
    emitAsyncMock = vi.fn();
    const mockEventEmitter = {
      emitAsync: emitAsyncMock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityEventPublisher,
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<IdentityEventPublisher>(IdentityEventPublisher);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should publish TenantProvisionedEvent", async () => {
    const event = new TenantProvisionedEvent("tenant1", "user1", "Tenant One");
    await service.publishTenantProvisioned(event);
    expect(emitAsyncMock).toHaveBeenCalledWith("tenant.provisioned", event);
  });

  it("should publish UserInvitedEvent", async () => {
    const event = new UserInvitedEvent(
      "inv1",
      "test@test.com",
      "tenant1",
      "admin",
    );
    await service.publishUserInvited(event);
    expect(emitAsyncMock).toHaveBeenCalledWith("user.invited", event);
  });
});
