import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetUserByIdUseCase } from "./get-user-by-id.use-case.js";
import type { IUserRepository } from "../../ports/outbound/user-repository.port.js";
import type { ITenantRepository } from "../../ports/outbound/tenant-repository.port.js";
import { NotFoundException } from "@nestjs/common";

describe("GetUserByIdUseCase", () => {
  let useCase: GetUserByIdUseCase;
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let tenantRepository: { findOneForUser: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    userRepository = { findById: vi.fn() };
    tenantRepository = { findOneForUser: vi.fn() };
    useCase = new GetUserByIdUseCase(
      userRepository as unknown as IUserRepository,
      tenantRepository as unknown as ITenantRepository,
    );
  });

  it("should throw NotFoundException if no tenantId provided", async () => {
    await expect(useCase.execute("user1")).rejects.toThrow(NotFoundException);
  });

  it("should throw NotFoundException if user not found", async () => {
    userRepository.findById.mockResolvedValue(null);
    await expect(useCase.execute("user1", "tenant1")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("should throw NotFoundException if user is not member of tenant", async () => {
    const user = { id: "user1" };
    userRepository.findById.mockResolvedValue(user);
    tenantRepository.findOneForUser.mockResolvedValue(null);

    await expect(useCase.execute("user1", "tenant1")).rejects.toThrow(
      NotFoundException,
    );
    expect(userRepository.findById).toHaveBeenCalledWith("user1");
    expect(tenantRepository.findOneForUser).toHaveBeenCalledWith(
      "user1",
      "tenant1",
    );
  });

  it("should return user if member of tenant", async () => {
    const user = { id: "user1" };
    userRepository.findById.mockResolvedValue(user);
    tenantRepository.findOneForUser.mockResolvedValue({ id: "tenant1" });

    const result = await useCase.execute("user1", "tenant1");
    expect(result).toEqual(user);
    expect(userRepository.findById).toHaveBeenCalledWith("user1");
    expect(tenantRepository.findOneForUser).toHaveBeenCalledWith(
      "user1",
      "tenant1",
    );
  });
});
