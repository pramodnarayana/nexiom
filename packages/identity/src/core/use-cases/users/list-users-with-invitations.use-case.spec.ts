import { describe, it, expect, vi, beforeEach } from "vitest";
import { ListUsersWithInvitationsUseCase } from "./list-users-with-invitations.use-case.js";
import type { UserRepositoryPort } from "../../ports/outbound/user-repository.port.js";
import type { IAuthProvider } from "../../ports/outbound/auth-provider.port.js";

describe("ListUsersWithInvitationsUseCase", () => {
  let useCase: ListUsersWithInvitationsUseCase;
  let userRepository: { findAll: ReturnType<typeof vi.fn> };
  let authProvider: { listInvitations: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    userRepository = { findAll: vi.fn() };
    authProvider = { listInvitations: vi.fn() };
    useCase = new ListUsersWithInvitationsUseCase(
      userRepository as unknown as UserRepositoryPort,
      authProvider as unknown as IAuthProvider,
    );
  });

  it("should return empty if tenantId is missing", async () => {
    const result = await useCase.execute("");
    expect(result).toEqual({ data: [], total: 0 });
  });

  it("should combine users and pending invitations", async () => {
    const users = [{ id: "u1", email: "user@example.com" }];
    userRepository.findAll.mockResolvedValue({ data: users, total: 1 });

    const invitations = [
      {
        id: "i1",
        email: "user@example.com",
        role: "member",
        createdAt: new Date(),
      }, // duplicate
      {
        id: "i2",
        email: "new@example.com",
        role: "admin",
        createdAt: new Date(),
      }, // new
    ];
    authProvider.listInvitations.mockResolvedValue(invitations);

    const result = await useCase.execute("org-1");
    expect(result.data).toHaveLength(2); // 1 user + 1 new invitation
    expect(result.total).toBe(2);
    const invitation = result.data[1] as unknown as {
      email: string;
      isInvitation: boolean;
      status: string;
    };
    expect(invitation.email).toBe("new@example.com");
    expect(invitation.isInvitation).toBe(true);
    expect(invitation.status).toBe("pending");
  });
});
