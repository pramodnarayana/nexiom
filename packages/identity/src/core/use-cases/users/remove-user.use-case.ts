import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { UserRepositoryPort } from "../../ports/outbound/user-repository.port.js";
import { USER_REPOSITORY } from "../../../constants.js";

@Injectable()
export class RemoveUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepositoryPort,
  ) {}

  async execute(
    userId: string,
    requestingUserId: string,
    tenantId: string,
  ): Promise<{ success: boolean; hardDeleted: boolean }> {
    if (userId === requestingUserId) {
      throw new BadRequestException("You cannot delete your own account.");
    }

    try {
      const result = await this.userRepository.deleteIfNotLastAdmin(
        userId,
        tenantId,
      );

      if (!result.success) {
        throw new BadRequestException(
          "Cannot delete the last admin of the organization",
        );
      }

      return { success: true, hardDeleted: result.hardDeleted ?? false };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("not a member of this organization")
      ) {
        throw new NotFoundException("User not found in this organization");
      }
      throw error;
    }
  }
}
