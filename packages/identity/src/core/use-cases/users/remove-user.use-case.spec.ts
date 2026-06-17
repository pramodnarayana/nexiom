import { describe, it, expect, vi, beforeEach } from "vitest";
import { RemoveUserUseCase } from "./remove-user.use-case.js";
import type { UserRepositoryPort } from "../../ports/outbound/user-repository.port.js";
import { BadRequestException, NotFoundException } from "@nestjs/common";

describe("RemoveUserUseCase", () => {
  let useCase: RemoveUserUseCase;
  let userRepository: { deleteIfNotLastAdmin: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    userRepository = { deleteIfNotLastAdmin: vi.fn() };
    useCase = new RemoveUserUseCase(
      userRepository as unknown as UserRepositoryPort,
    );
  });

  it("should throw BadRequestException if deleting self", async () => {
    await expect(useCase.execute("u1", "u1", "tenant1")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("should throw BadRequestException if last admin", async () => {
    userRepository.deleteIfNotLastAdmin.mockResolvedValue({ success: false });
    await expect(useCase.execute("u2", "u1", "tenant1")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("should throw NotFoundException if not a member", async () => {
    userRepository.deleteIfNotLastAdmin.mockRejectedValue(
      new Error("User is not a member of this organization"),
    );
    await expect(useCase.execute("u2", "u1", "tenant1")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("should propagate generic errors", async () => {
    userRepository.deleteIfNotLastAdmin.mockRejectedValue(
      new Error("Generic db error"),
    );
    await expect(useCase.execute("u2", "u1", "tenant1")).rejects.toThrow(
      "Generic db error",
    );
  });

  it("should return success and hardDeleted status on success", async () => {
    userRepository.deleteIfNotLastAdmin.mockResolvedValue({
      success: true,
      hardDeleted: true,
    });
    const result = await useCase.execute("u2", "u1", "tenant1");
    expect(result).toEqual({ success: true, hardDeleted: true });
  });
});
