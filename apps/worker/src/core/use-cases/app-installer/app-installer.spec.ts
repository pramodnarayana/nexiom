import { describe, it, expect, beforeEach } from "vitest";
import { QueueName } from "@soopa/queue";
import { InstallPieceUseCase } from "./install-piece.use-case.js";
import { CheckPieceUpdatesUseCase } from "./check-piece-updates.use-case.js";
import {
  FakePieceRegistry,
  FakeWorkspacePiecesRepository,
} from "../../fakes/fake-app-installer-ports.js";
import { FakeQueuePublisher } from "../../fakes/fake-queue.publisher.js";

describe("App Installer Use Cases", () => {
  let registry: FakePieceRegistry;
  let repository: FakeWorkspacePiecesRepository;
  let queuePublisher: FakeQueuePublisher;

  beforeEach(() => {
    registry = new FakePieceRegistry();
    repository = new FakeWorkspacePiecesRepository();
    queuePublisher = new FakeQueuePublisher();
  });

  describe("InstallPieceUseCase", () => {
    let useCase: InstallPieceUseCase;

    beforeEach(() => {
      useCase = new InstallPieceUseCase(registry, repository);
    });

    it("should install a piece and mark it installed in the workspace", async () => {
      await useCase.execute({
        packageName: "@nexiom/salesforce",
        version: "1.0.0",
        workspaceId: "ws-1",
        pieceId: "piece-1",
      });

      expect(registry.installed).toHaveLength(1);
      expect(registry.installed[0]).toEqual({
        packageName: "@nexiom/salesforce",
        version: "1.0.0",
      });

      const dbStatus = repository.pieces.get("ws-1:piece-1");
      expect(dbStatus?.status).toBe("INSTALLED");
      expect(dbStatus?.version).toBe("1.0.0");
    });

    it("should mark as failed if installation throws", async () => {
      registry.shouldFail = true;

      await expect(
        useCase.execute({
          packageName: "@nexiom/salesforce",
          version: "1.0.0",
          workspaceId: "ws-1",
          pieceId: "piece-1",
        }),
      ).rejects.toThrow("Failed to install @nexiom/salesforce");

      const dbStatus = repository.pieces.get("ws-1:piece-1");
      expect(dbStatus?.status).toBe("FAILED");
      expect(dbStatus?.failed).toBe(true);
    });

    it("should gracefully handle DB errors when attempting to mark as failed", async () => {
      registry.shouldFail = true;
      // Inject a mock that throws an error when markFailed is called
      repository.markFailed = async () => {
        await Promise.resolve();
        throw new Error("DB Error");
      };

      await expect(
        useCase.execute({
          packageName: "@nexiom/salesforce",
          version: "1.0.0",
          workspaceId: "ws-1",
          pieceId: "piece-1",
        }),
      ).rejects.toThrow("Failed to install @nexiom/salesforce");
    });
  });

  describe("CheckPieceUpdatesUseCase", () => {
    let useCase: CheckPieceUpdatesUseCase;

    beforeEach(() => {
      useCase = new CheckPieceUpdatesUseCase(
        repository,
        registry,
        queuePublisher,
      );
    });

    it("should enqueue plugin install events for pieces with newer versions", async () => {
      repository.installedPieces = [
        {
          workspaceId: "ws-1",
          pieceId: "piece-1",
          packageName: "@nexiom/salesforce",
          currentVersion: "1.0.0",
        },
        {
          workspaceId: "ws-2",
          pieceId: "piece-2",
          packageName: "@nexiom/github",
          currentVersion: "2.5.0",
        },
      ];

      registry.latestVersions.set("@nexiom/salesforce", "1.1.0");
      registry.latestVersions.set("@nexiom/github", "2.5.0"); // Same version

      await useCase.execute();

      expect(queuePublisher.messages).toHaveLength(1);
      expect(queuePublisher.messages[0].queueName).toBe(
        QueueName.PluginInstallQueue,
      );

      const payload = queuePublisher.messages[0]
        .payload as import("@soopa/queue").PluginInstallEvent;
      expect(payload.packageName).toBe("@nexiom/salesforce");
      expect(payload.version).toBe("1.1.0");
      expect(payload.workspaceId).toBe("ws-1");
    });

    it("should ignore apps if getting latest version from registry fails", async () => {
      repository.installedPieces = [
        {
          workspaceId: "ws-1",
          pieceId: "piece-1",
          packageName: "@nexiom/salesforce",
          currentVersion: "1.0.0",
        },
      ];

      // Not setting it in registry will cause FakePieceRegistry to throw "not found"
      await expect(useCase.execute()).resolves.not.toThrow();

      expect(queuePublisher.messages).toHaveLength(0);
    });

    it("should continue if queue publisher fails to enqueue an update", async () => {
      repository.installedPieces = [
        {
          workspaceId: "ws-1",
          pieceId: "piece-1",
          packageName: "@nexiom/salesforce",
          currentVersion: "1.0.0",
        },
        {
          workspaceId: "ws-2",
          pieceId: "piece-2",
          packageName: "@nexiom/github",
          currentVersion: "2.0.0",
        },
      ];

      registry.latestVersions.set("@nexiom/salesforce", "1.1.0");
      registry.latestVersions.set("@nexiom/github", "2.1.0");
      queuePublisher.shouldFail = true;

      await expect(useCase.execute()).resolves.not.toThrow();
    });
  });
});
