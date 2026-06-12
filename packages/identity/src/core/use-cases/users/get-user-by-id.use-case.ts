import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { USER_REPOSITORY, TENANT_REPOSITORY } from "../../../constants.js";
import type { IUserRepository } from "../../ports/outbound/user-repository.port.js";
import type { ITenantRepository } from "../../ports/outbound/tenant-repository.port.js";

@Injectable()
export class GetUserByIdUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: IUserRepository,
    @Inject(TENANT_REPOSITORY)
    private readonly tenantRepository: ITenantRepository,
  ) {}

  async execute(id: string, tenantId?: string) {
    // If no tenantId is provided (e.g., system admin or pure identity scope),
    // they don't have access to this endpoint by default unless we allow it,
    // but the controller ensures tenantId is passed for normal requests.
    if (!tenantId) {
      throw new NotFoundException("User not found");
    }

    const user = await this.userRepository.findById(id);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Tenant Scoping check
    // Ensure the target user is a member of the requester's tenant
    const tenant = await this.tenantRepository.findOneForUser(
      user.id,
      tenantId,
    );
    const isMember = Boolean(tenant);

    if (!isMember) {
      throw new NotFoundException("User not found"); // Mask existence for security
    }

    return user;
  }
}
