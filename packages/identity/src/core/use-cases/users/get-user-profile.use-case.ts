import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { USER_REPOSITORY } from "../../../constants.js";
import type { UserRepositoryPort } from "../../ports/outbound/user-repository.port.js";

@Injectable()
export class GetUserProfileUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepositoryPort,
  ) {}

  async execute(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }
    return user;
  }
}
