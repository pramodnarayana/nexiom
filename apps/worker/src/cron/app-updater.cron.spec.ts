/* eslint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppUpdaterCron } from "./app-updater.cron.js";
import {
  DeliveryService,
  FanoutRouterService,
  ReplicaService,
  NormalizationService,
} from "@soopa/pipeline";
import type { IQueueService } from "@soopa/queue";
import type { DrizzleDb } from "@soopa/database";

describe("AppUpdaterCron", () => {
  let cronJob: AppUpdaterCron;
  let queueServiceMock: { send: ReturnType<typeof vi.fn> };
  let dbMock: { selectDistinct: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    queueServiceMock = {
      send: vi.fn(),
    };

    dbMock = {
      selectDistinct: vi.fn(),
    };

    cronJob = new AppUpdaterCron(
      queueServiceMock as unknown as IQueueService,
      dbMock as unknown as DrizzleDb,
    );
  });

  describe("isNewer (pure logic)", () => {
    it("returns true if remote version is a newer patch", () => {
      expect(cronJob["isNewer"]("1.0.0", "1.0.1")).toBe(true);
    });

    it("returns true if remote version is a newer minor", () => {
      expect(cronJob["isNewer"]("1.0.5", "1.1.0")).toBe(true);
    });

    it("returns true if remote version is a newer major", () => {
      expect(cronJob["isNewer"]("1.5.0", "2.0.0")).toBe(true);
    });

    it("returns false if remote version is the same", () => {
      expect(cronJob["isNewer"]("1.2.3", "1.2.3")).toBe(false);
    });

    it("returns false if remote version is older", () => {
      expect(cronJob["isNewer"]("2.0.0", "1.9.9")).toBe(false);
    });

    it("handles missing patch versions", () => {
      expect(cronJob["isNewer"]("1.0", "1.0.1")).toBe(true);
      expect(cronJob["isNewer"]("1.0.1", "1.0")).toBe(false);
    });
  });

  describe("checkUpdates", () => {
    let selectDistinctMock: ReturnType<typeof vi.fn>;
    let fromMock: ReturnType<typeof vi.fn>;
    let innerJoinMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      innerJoinMock = vi.fn().mockResolvedValue([]);
      fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock });
      selectDistinctMock = vi.fn().mockReturnValue({ from: fromMock });
      dbMock.selectDistinct = selectDistinctMock;

      vi.mock("axios", () => {
        return {
          default: {
            get: vi.fn(),
          },
        };
      });
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it("should process updates for outdated plugins", async () => {
      const axiosMock = (await import("axios")).default as unknown as {
        get: ReturnType<typeof vi.fn>;
      };
      axiosMock.get.mockResolvedValueOnce({
        data: { version: "2.0.0" },
      });

      innerJoinMock.mockResolvedValueOnce([
        {
          pieceId: "p-1",
          packageName: "@soopa/piece-outdated",
          currentVersion: "1.0.0",
          workspaceId: "w-1",
        },
      ]);

      await cronJob.checkUpdates();

      expect(axiosMock.get).toHaveBeenCalledWith(
        "https://registry.npmjs.org/@soopa/piece-outdated/latest",
        { timeout: 5000 },
      );
      expect(queueServiceMock.send).toHaveBeenCalled();
    });

    it("should skip if version is same or older", async () => {
      const axiosMock = (await import("axios")).default as unknown as {
        get: ReturnType<typeof vi.fn>;
      };
      axiosMock.get.mockResolvedValueOnce({
        data: { version: "1.0.0" },
      });

      innerJoinMock.mockResolvedValueOnce([
        {
          pieceId: "p-1",
          packageName: "@soopa/piece-same",
          currentVersion: "1.0.0",
          workspaceId: "w-1",
        },
      ]);

      await cronJob.checkUpdates();

      expect(queueServiceMock.send).not.toHaveBeenCalled();
    });

    it("should handle axios errors gracefully", async () => {
      const axiosMock = (await import("axios")).default as unknown as {
        get: ReturnType<typeof vi.fn>;
      };
      axiosMock.get.mockRejectedValueOnce(new Error("Network Error"));

      innerJoinMock.mockResolvedValueOnce([
        {
          pieceId: "p-1",
          packageName: "@soopa/piece-error",
          currentVersion: "1.0.0",
          workspaceId: "w-1",
        },
      ]);

      await cronJob.checkUpdates();

      expect(queueServiceMock.send).not.toHaveBeenCalled();
    });
  });
});
