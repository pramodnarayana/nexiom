import { describe, it, expect, vi, beforeEach } from "vitest";
import { CreateUserUseCase } from "./create-user.use-case.js";
import type { UserRepositoryPort } from "../../ports/outbound/user-repository.port.js";

describe("CreateUserUseCase", () => {
  let useCase: CreateUserUseCase;
  let userRepository: { create: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    userRepository = { create: vi.fn() };
    useCase = new CreateUserUseCase(
      userRepository as unknown as UserRepositoryPort,
    );
  });

  it("should call userRepository.create and return the result", async () => {
    const payload = { email: "test@example.com", role: "member" as const };
    const expectedUser = { id: "user1", email: "test@example.com" };

    userRepository.create.mockResolvedValue(expectedUser);

    const result = await useCase.execute(payload);

    expect(result).toEqual(expectedUser);
    expect(userRepository.create).toHaveBeenCalledWith(payload);
  });
});
