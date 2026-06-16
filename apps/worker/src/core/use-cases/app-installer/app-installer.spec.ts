import { describe, it, expect, beforeEach, vi } from "vitest";
import { InstallPieceUseCase } from "./install-piece.use-case.js";
import { CheckPieceUpdatesUseCase } from "./check-piece-updates.use-case.js";
import { QueueName } from "@soopa/queue";
import {
  FakePieceRegistry,
  FakeGlobalPiecesRepository,
  FakeLoggerPort,
} from "../../fakes/fake-app-installer-ports.js";
import { FakeQueuePublisher } from "../../fakes/fake-queue.publisher.js";
import { FakeRealtimeEventPubSub } from "../../fakes/fake-copilot-ports.js";

describe("App Installer Subdomain", () => {
  let registry: FakePieceRegistry;
  let repository: FakeGlobalPiecesRepository;
  let queuePublisher: FakeQueuePublisher;
  let logger: FakeLoggerPort;

  beforeEach(() => {
    registry = new FakePieceRegistry();
    repository = new FakeGlobalPiecesRepository();
    queuePublisher = new FakeQueuePublisher();
    logger = new FakeLoggerPort();
  });

  describe("InstallPieceUseCase", () => {
    it("should successfully install a piece and register it globally", async () => {
      registry.requireMocks.set("test-package", {
        piece: {
          name: "test-piece",
          displayName: "Test Piece",
          logoUrl: "http://logo",
        },
      });

      const pubsub = new FakeRealtimeEventPubSub();
      const publishSpy = vi.spyOn(pubsub, "publishSystemEvent");
      const useCase = new InstallPieceUseCase(
        registry,
        repository,
        pubsub,
        logger,
      );

      await useCase.execute({
        packageName: "test-package",
        version: "1.0.0",
      });

      expect(registry.installed).toContainEqual({
        packageName: "test-package",
        version: "1.0.0",
      });

      const registered = repository.pieces.get("test-piece");
      expect(registered).toBeDefined();
      expect(registered?.version).toBe("1.0.0");

      expect(publishSpy).toHaveBeenCalledWith(
        "system:plugins:reloaded",
        expect.objectContaining({
          packageName: "test-package",
          version: "1.0.0",
        }),
      );
    });

    it("should fail gracefully if installation fails", async () => {
      registry.shouldFail = true;

      const pubsub = new FakeRealtimeEventPubSub();
      const publishSpy = vi.spyOn(pubsub, "publishSystemEvent");
      const useCase = new InstallPieceUseCase(
        registry,
        repository,
        pubsub,
        logger,
      );

      await expect(
        useCase.execute({
          packageName: "test-package",
          version: "1.0.0",
        }),
      ).rejects.toThrow("Failed to install test-package");

      expect(publishSpy).not.toHaveBeenCalled();
    });

    it("should successfully extract piece using moduleExports.register()", async () => {
      registry.requireMocks.set("test-package-register", {
        register: () => ({
          name: "test-piece-register",
          displayName: "Test Piece Register",
        }),
      });

      const pubsub = new FakeRealtimeEventPubSub();
      const publishSpy = vi.spyOn(pubsub, "publishSystemEvent");
      const useCase = new InstallPieceUseCase(
        registry,
        repository,
        pubsub,
        logger,
      );

      await useCase.execute({
        packageName: "test-package-register",
        version: "1.0.0",
      });

      const registered = repository.pieces.get("test-piece-register");
      expect(registered).toBeDefined();

      expect(publishSpy).toHaveBeenCalledWith(
        "system:plugins:reloaded",
        expect.objectContaining({
          packageName: "test-package-register",
          version: "1.0.0",
        }),
      );
    });

    it("should successfully extract piece using moduleExports.default.register()", async () => {
      registry.requireMocks.set("test-package-default-register", {
        default: {
          register: () => ({
            name: "test-piece-default-register",
            displayName: "Test Piece Default",
          }),
        },
      });

      const pubsub = new FakeRealtimeEventPubSub();
      const publishSpy = vi.spyOn(pubsub, "publishSystemEvent");
      const useCase = new InstallPieceUseCase(
        registry,
        repository,
        pubsub,
        logger,
      );

      await useCase.execute({
        packageName: "test-package-default-register",
        version: "1.0.0",
      });

      const registered = repository.pieces.get("test-piece-default-register");
      expect(registered).toBeDefined();

      expect(publishSpy).toHaveBeenCalledWith(
        "system:plugins:reloaded",
        expect.objectContaining({
          packageName: "test-package-default-register",
          version: "1.0.0",
        }),
      );
    });

    it("should successfully extract piece directly from moduleExports.default object", async () => {
      registry.requireMocks.set("test-package-default-object", {
        default: {
          name: "test-piece-default-object",
          displayName: "Test Piece Default Object",
        },
      });

      const pubsub = new FakeRealtimeEventPubSub();
      const publishSpy = vi.spyOn(pubsub, "publishSystemEvent");
      const useCase = new InstallPieceUseCase(
        registry,
        repository,
        pubsub,
        logger,
      );

      await useCase.execute({
        packageName: "test-package-default-object",
        version: "1.0.0",
      });

      const registered = repository.pieces.get("test-piece-default-object");
      expect(registered).toBeDefined();

      expect(publishSpy).toHaveBeenCalledWith(
        "system:plugins:reloaded",
        expect.objectContaining({
          packageName: "test-package-default-object",
          version: "1.0.0",
        }),
      );
    });

    it("should successfully extract and register all optional fields (description, categories, auth, aliases)", async () => {
      registry.requireMocks.set("test-package-full", {
        piece: {
          name: "test-piece-full",
          displayName: "Test Piece Full",
          logoUrl: "http://logo",
          description: "A piece with all fields",
          categories: ["CRM", "Sales"],
          auth: {
            type: "OAUTH2",
            props: { clientId: "xyz" },
          },
          aliases: [{ name: "old-piece-name" }],
        },
      });

      const pubsub = new FakeRealtimeEventPubSub();
      const publishSpy = vi.spyOn(pubsub, "publishSystemEvent");
      const useCase = new InstallPieceUseCase(
        registry,
        repository,
        pubsub,
        logger,
      );

      await useCase.execute({
        packageName: "test-package-full",
        version: "1.0.0",
      });

      const registered = repository.pieces.get("test-piece-full");
      expect(registered).toBeDefined();
      expect(registered?.description).toBe("A piece with all fields");
      expect(registered?.categories).toEqual(["CRM", "Sales"]);
      expect(registered?.authType).toBe("OAUTH2");
      expect(registered?.authSchema).toEqual({ clientId: "xyz" });
      expect(registered?.aliases).toEqual([{ name: "old-piece-name" }]);

      expect(publishSpy).toHaveBeenCalledWith(
        "system:plugins:reloaded",
        expect.objectContaining({
          packageName: "test-package-full",
          version: "1.0.0",
        }),
      );
    });

    it("should handle auto-registration failure if no valid piece object is found", async () => {
      registry.requireMocks.set("test-package-invalid", {
        default: {
          register: () => ({
            name: "missing-display-name",
          }),
        },
      });

      const pubsub = new FakeRealtimeEventPubSub();
      const publishSpy = vi.spyOn(pubsub, "publishSystemEvent");
      const useCase = new InstallPieceUseCase(
        registry,
        repository,
        pubsub,
        logger,
      );

      await expect(
        useCase.execute({
          packageName: "test-package-invalid",
          version: "1.0.0",
        }),
      ).rejects.toThrow("Could not find exported piece object");

      const registered = repository.pieces.get("missing-display-name");
      expect(registered).toBeUndefined();

      expect(publishSpy).not.toHaveBeenCalled();
    });

    it("should fail gracefully if global piece auto-registration throws", async () => {
      registry.requireMocks.set("test-package-error", {
        register: () => {
          throw new Error("Initialization error");
        },
      });

      const pubsub = new FakeRealtimeEventPubSub();
      const publishSpy = vi.spyOn(pubsub, "publishSystemEvent");
      const useCase = new InstallPieceUseCase(
        registry,
        repository,
        pubsub,
        logger,
      );

      await expect(
        useCase.execute({
          packageName: "test-package-error",
          version: "1.0.0",
        }),
      ).rejects.toThrow("Initialization error");

      expect(publishSpy).not.toHaveBeenCalled();
    });
  });

  describe("CheckPieceUpdatesUseCase", () => {
    it("should detect newer versions and enqueue updates", async () => {
      repository.pieces.set("test-piece", {
        name: "test-piece",
        displayName: "Test",
        packageName: "test-package",
        version: "1.0.0",
      });

      registry.latestVersions.set("test-package", "1.1.0");

      const useCase = new CheckPieceUpdatesUseCase(
        repository,
        registry,
        queuePublisher,
        logger,
      );

      await useCase.execute();

      expect(queuePublisher.messages.length).toBe(1);
      const msg = queuePublisher.messages[0];
      expect(msg.queueName).toBe(QueueName.PluginInstallQueue);
      const payload = msg.payload as Record<string, unknown>;
      expect(payload.packageName).toBe("test-package");
      expect(payload.version).toBe("1.1.0");
    });

    it("should not enqueue update if versions are same", async () => {
      repository.pieces.set("test-piece", {
        name: "test-piece",
        displayName: "Test",
        packageName: "test-package",
        version: "1.0.0",
      });

      registry.latestVersions.set("test-package", "1.0.0");

      const useCase = new CheckPieceUpdatesUseCase(
        repository,
        registry,
        queuePublisher,
        logger,
      );

      await useCase.execute();

      expect(queuePublisher.messages.length).toBe(0);
    });

    it("should skip piece if version is missing", async () => {
      repository.pieces.set("test-piece", {
        name: "test-piece",
        displayName: "Test",
        packageName: "test-package",
        version: undefined as unknown as string,
      });

      const useCase = new CheckPieceUpdatesUseCase(
        repository,
        registry,
        queuePublisher,
        logger,
      );
      await useCase.execute();
      expect(queuePublisher.messages.length).toBe(0);
    });

    it("should ignore and continue if registry fails to fetch latest version", async () => {
      repository.pieces.set("test-piece", {
        name: "test-piece",
        displayName: "Test",
        packageName: "test-package",
        version: "1.0.0",
      });
      registry.shouldFail = true;

      const useCase = new CheckPieceUpdatesUseCase(
        repository,
        registry,
        queuePublisher,
        logger,
      );
      await useCase.execute();
      expect(queuePublisher.messages.length).toBe(0);
    });

    it("should gracefully handle queue publisher failures", async () => {
      repository.pieces.set("test-piece", {
        name: "test-piece",
        displayName: "Test",
        packageName: "test-package",
        version: "1.0.0",
      });
      registry.latestVersions.set("test-package", "1.1.0");
      queuePublisher.shouldFail = true;

      const useCase = new CheckPieceUpdatesUseCase(
        repository,
        registry,
        queuePublisher,
        logger,
      );
      await useCase.execute();
      expect(queuePublisher.messages.length).toBe(0);
    });

    it("should handle non-semver versions using string fallback", async () => {
      repository.pieces.set("test-piece", {
        name: "test-piece",
        displayName: "Test",
        packageName: "test-package",
        version: "v1-alpha",
      });
      registry.latestVersions.set("test-package", "v1-beta");

      const useCase = new CheckPieceUpdatesUseCase(
        repository,
        registry,
        queuePublisher,
        logger,
      );
      await useCase.execute();
      expect(queuePublisher.messages.length).toBe(1);
    });
  });
});
