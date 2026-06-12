import { Injectable, Inject } from "@nestjs/common";
import { IUserRepository } from "../../ports/outbound/user-repository.port.js";
import { USER_REPOSITORY, AUTH_PROVIDER } from "../../../constants.js";
import type { IAuthProvider } from "../../ports/outbound/auth-provider.port.js";
import type { UserListItem, Invitation } from "../../ports/outbound/types.js";

@Injectable()
export class ListUsersWithInvitationsUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: IUserRepository,
    @Inject(AUTH_PROVIDER) private readonly authProvider: IAuthProvider,
  ) {}

  async execute(
    tenantId: string,
  ): Promise<{ data: UserListItem[]; total: number }> {
    if (!tenantId) {
      return { data: [], total: 0 };
    }

    const { data: users, total: userTotal } = await this.userRepository.findAll(
      { tenantId },
    );
    const invitations = await this.authProvider.listInvitations(tenantId);

    const existingEmails = new Set(
      users.map((u: { email: string }) => u.email.toLowerCase()),
    );
    const pendingInvitations = invitations.filter(
      (inv: { email: string }) => !existingEmails.has(inv.email.toLowerCase()),
    );

    const invitedUsers: UserListItem[] = pendingInvitations.map(
      (inv: Invitation) => ({
        id: inv.id,
        email: inv.email,
        name: "",
        role: inv.role ?? "member",
        status: "pending",
        emailVerified: false,
        createdAt: inv.createdAt,
        updatedAt: inv.createdAt,
        isInvitation: true,
        permissions: undefined,
        image: undefined,
        banned: false,
      }),
    );

    const combinedData = [...users, ...invitedUsers];

    return {
      data: combinedData,
      total: userTotal + pendingInvitations.length,
    };
  }
}
