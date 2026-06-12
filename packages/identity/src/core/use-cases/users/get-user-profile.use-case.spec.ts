import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetUserProfileUseCase } from "./get-user-profile.use-case.js";
import type { IUserRepository } from "../../ports/outbound/user-repository.port.js";

describe("GetUserProfileUseCase", () => {
  let useCase: GetUserProfileUseCase;
  let userRepository: { findById: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    userRepository = { findById: vi.fn() };
    useCase = new GetUserProfileUseCase(
      userRepository as unknown as IUserRepository,
    );
  });

  it("should call userRepository.findById and return the user", async () => {
    const expectedUser = { id: "user1", email: "test@example.com" };
    userRepository.findById.mockResolvedValue(expectedUser);

    const result = await useCase.execute("user1");

    expect(result).toEqual(expectedUser);
    expect(userRepository.findById).toHaveBeenCalledWith("user1");
  });
});
