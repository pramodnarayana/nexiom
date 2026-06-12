import { Inject, Injectable } from "@nestjs/common";
import { USER_REPOSITORY } from "../../../constants.js";
import type {
  IUserRepository,
  CreateUserInput,
} from "../../ports/outbound/user-repository.port.js";

@Injectable()
export class CreateUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: IUserRepository,
  ) {}

  async execute(input: CreateUserInput) {
    return this.userRepository.create(input);
  }
}
