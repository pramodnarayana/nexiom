import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppInstallerProcessor } from "./app-installer.processor.js";
import { QueueName } from "@soopa/queue";
import type { IQueueService, PluginInstallEvent } from "@soopa/queue";
import { PluginManagerService } from "@soopa/piece-registry";
import type { DrizzleDb } from "@soopa/database";

describe("AppInstallerProcessor", () => {
  let processor: AppInstallerProcessor;
  let queueServiceMock: {
    consume: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
  let pluginManagerMock: { installPiece: ReturnType<typeof vi.fn> };
  let dbMock: {
    update: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    queueServiceMock = {
      consume: vi.fn(),
      send: vi.fn(),
    };

    pluginManagerMock = {
      installPiece: vi.fn(),
    };

    dbMock = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };

    processor = new AppInstallerProcessor(
      queueServiceMock as unknown as IQueueService,
      pluginManagerMock as unknown as PluginManagerService,
      dbMock as unknown as DrizzleDb,
    );
  });

  it("registers a consumer for PluginInstallQueue on init", () => {
    processor.onModuleInit();
    expect(queueServiceMock.consume).toHaveBeenCalledWith(
      QueueName.PluginInstallQueue,
      expect.any(Function),
    );
  });

  describe("processing workflow", () => {
    let handler: (event: PluginInstallEvent) => Promise<void>;

    beforeEach(() => {
      processor.onModuleInit();
      handler = queueServiceMock.consume.mock.calls[0][1] as (
        event: PluginInstallEvent,
      ) => Promise<void>;
    });

    it("downloads the piece and marks it as INSTALLED", async () => {
      pluginManagerMock.installPiece.mockResolvedValue({ version: "1.2.0" });

      await handler({
        packageName: "@soopa/piece-salesforce",
        version: "1.2.0",
        workspaceId: "ws-123",
        pieceId: "piece-123",
      });

      expect(pluginManagerMock.installPiece).toHaveBeenCalledWith(
        "@soopa/piece-salesforce",
        "1.2.0",
      );
      expect(dbMock.update).toHaveBeenCalled();
      expect(dbMock.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "INSTALLED",
          installedVersion: "1.2.0",
        }),
      );
      expect(dbMock.where).toHaveBeenCalled();
    });

    it("installs the piece without DB updates if workspaceId is missing", async () => {
      pluginManagerMock.installPiece.mockResolvedValue({ version: "1.2.0" });

      await handler({
        packageName: "@soopa/piece-global",
        version: "1.2.0",
      });

      expect(pluginManagerMock.installPiece).toHaveBeenCalledWith(
        "@soopa/piece-global",
        "1.2.0",
      );
      expect(dbMock.update).not.toHaveBeenCalled();
    });

    it("marks the piece as FAILED if installation throws an error", async () => {
      pluginManagerMock.installPiece.mockRejectedValue(
        new Error("NPM Network Error"),
      );

      await expect(
        handler({
          packageName: "@soopa/piece-salesforce",
          version: "1.2.0",
          workspaceId: "ws-123",
          pieceId: "piece-123",
        }),
      ).rejects.toThrow("NPM Network Error");

      expect(dbMock.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "FAILED",
        }),
      );
    });
  });
});
