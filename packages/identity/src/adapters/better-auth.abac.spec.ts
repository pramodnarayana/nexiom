/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from "@nestjs/testing";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { BetterAuthAdapter } from "./better-auth.adapter";
import {
  IDENTITY_DB,
  IDENTITY_OPTIONS,
  EMAIL_PROVIDER,
  TENANT_PROVIDER,
  BETTER_AUTH_CONFIG,
} from "../constants";

const mockDb: any = {
  query: {
    user: { findFirst: vi.fn() },
    session: { findFirst: vi.fn() },
    member: { findMany: vi.fn() },
    rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
  },
};

describe("BetterAuthAdapter ABAC", () => {
  let adapter: BetterAuthAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BetterAuthAdapter,
        { provide: IDENTITY_DB, useValue: mockDb },
        {
          provide: IDENTITY_OPTIONS,
          useValue: { constants: { systemTenantId: "system" } },
        },
        { provide: EMAIL_PROVIDER, useValue: { sendEmail: vi.fn() } },
        { provide: TENANT_PROVIDER, useValue: { findAllForUser: vi.fn() } },
        {
          provide: BETTER_AUTH_CONFIG,
          useValue: {
            allowedOrigins: ["http://localhost"],
            betterAuthUrl: "http://localhost",
          },
        },
      ],
    }).compile();

    adapter = module.get<BetterAuthAdapter>(BetterAuthAdapter);
  });

  it("should return simple string for simple permission", async () => {
    const mockUser = {
      id: "u1",
      email: "test@example.com",
      members: [
        {
          role: {
            id: "admin",
            name: "admin",
            permissions: [
              {
                permission: { resource: "User", action: "read" },
                conditions: null,
                permissionId: "p1",
              },
            ],
          },
        },
      ],
    };

    mockDb.query.user.findFirst.mockResolvedValue(mockUser);

    const user = await adapter.findById("u1");
    expect(user.permissions).toContain("User:read");
  });

  it("should return JSON string for conditional permission", async () => {
    const condition = { role: { $ne: "owner" } };
    const mockUser = {
      id: "u1",
      email: "test@example.com",
      members: [
        {
          role: {
            id: "admin",
            name: "admin",
            permissions: [
              {
                permission: { resource: "User", action: "delete" },
                conditions: condition,
                permissionId: "p2",
              },
            ],
          },
        },
      ],
    };

    mockDb.query.user.findFirst.mockResolvedValue(mockUser);

    const user = await adapter.findById("u1");
    const expectedRule = JSON.stringify({
      action: "delete",
      subject: "User",
      conditions: condition,
    });
    expect(user.permissions).toContain(expectedRule);
  });
});
