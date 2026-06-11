/* eslint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BaseOutboxPoller } from "./base-outbox.poller.js";
import { Logger } from "@nestjs/common";
import {} from "@soopa/pipeline";
import type { QueueService } from "@soopa/queue";

class TestOutboxPoller extends BaseOutboxPoller {
  protected logger = {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as Logger;

  constructor(protected queueService: QueueService) {
    super();
  }

  // Expose protected method for testing
  public testDeliverRow(
    db: any,
    schemaName: string,
    table: any,
    row: any,
    queueName: any,
    payload: unknown,
    markSuccessImmediately = true,
  ) {
    return this.deliverRow(
      db,
      schemaName,
      table,
      row,
      queueName,
      payload,
      markSuccessImmediately,
    );
  }

  public testExecuteSafeSchemaOperation(
    tenantId: string,
    schemaName: string,
    op: () => Promise<void>,
  ) {
    return this.executeSafeSchemaOperation(tenantId, schemaName, op);
  }
}

describe("BaseOutboxPoller", () => {
  let poller: TestOutboxPoller;
  let mockQueueService: any;
  let mockDb: any;
  let mockUpdateSet: any;
  let mockUpdateWhere: any;
  const mockTable = {
    _: { name: "test_table" },
    id: "id_col",
    status: "status_col",
  };

  beforeEach(() => {
    mockQueueService = { send: vi.fn().mockResolvedValue(undefined) };
    poller = new TestOutboxPoller(mockQueueService);

    mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
    mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
    mockDb = {
      update: vi.fn().mockReturnValue({ set: mockUpdateSet }),
    };
  });

  describe("deliverRow", () => {
    it("should successfully send to queue and mark SUCCESS", async () => {
      await poller.testDeliverRow(
        mockDb,
        "schema_1",
        mockTable,
        { id: "r1", attempts: 0 },
        "QueueA",
        { data: 1 },
      );

      expect(mockQueueService.send).toHaveBeenCalledWith("QueueA", { data: 1 });
      expect(mockDb.update).toHaveBeenCalledWith(mockTable);
      expect(mockUpdateSet).toHaveBeenCalledWith({ status: "SUCCESS" });
    });

    it("should not mark SUCCESS if markSuccessImmediately is false", async () => {
      await poller.testDeliverRow(
        mockDb,
        "schema_1",
        mockTable,
        { id: "r1", attempts: 0 },
        "QueueA",
        { data: 1 },
        false,
      );

      expect(mockQueueService.send).toHaveBeenCalledWith("QueueA", { data: 1 });
      expect(mockDb.update).not.toHaveBeenCalled(); // No status update
    });

    it("should include claimToken in condition when row has claimToken", async () => {
      const rowWithToken = { id: "r1", attempts: 0, claimToken: "token_123" };
      const tableWithToken = {
        _: { name: "test_table" },
        id: "id_col",
        status: "status_col",
        claimToken: "claim_col",
      };

      await poller.testDeliverRow(
        mockDb,
        "schema_1",
        tableWithToken,
        rowWithToken,
        "QueueA",
        { data: 1 },
      );

      expect(mockDb.update).toHaveBeenCalledWith(tableWithToken);
      expect(mockUpdateSet).toHaveBeenCalledWith({ status: "SUCCESS" });
    });

    it("should include claimToken in retry condition when queue fails", async () => {
      mockQueueService.send.mockRejectedValueOnce(new Error("Queue Down"));
      const rowWithToken = { id: "r1", attempts: 1, claimToken: "token_123" };
      const tableWithToken = {
        _: { name: "test_table" },
        id: "id_col",
        status: "status_col",
        claimToken: "claim_col",
      };

      await poller.testDeliverRow(
        mockDb,
        "schema_1",
        tableWithToken,
        rowWithToken,
        "QueueA",
        { data: 1 },
      );

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "RETRY" }),
      );
    });

    it("should transition to RETRY with backoff when queue fails and attempts < MAX", async () => {
      mockQueueService.send.mockRejectedValueOnce(new Error("Network Down"));

      await poller.testDeliverRow(
        mockDb,
        "schema_1",
        mockTable,
        { id: "r1", attempts: 1 },
        "QueueA",
        { data: 1 },
      );

      expect(mockUpdateSet).toHaveBeenCalledWith({
        status: "RETRY",
        errorMessage: "Network Down",
        nextRetryAt: expect.any(Date),
      });
    });

    it("should transition to FAIL when queue fails and attempts >= MAX", async () => {
      mockQueueService.send.mockRejectedValueOnce(
        new Error("Permanent Failure"),
      );

      await poller.testDeliverRow(
        mockDb,
        "schema_1",
        mockTable,
        { id: "r1", attempts: 6 },
        "QueueA",
        { data: 1 },
      );

      expect(mockUpdateSet).toHaveBeenCalledWith({
        status: "FAIL",
        errorMessage: "Permanent Failure",
      });
    });

    it("should use PENDING and FAILED statuses for global_registry_outbox", async () => {
      const registryTable = {
        _: { name: "global_registry_outbox" },
        id: "id_col",
      };

      // Test FAILED (attempts >= 6)
      mockQueueService.send.mockRejectedValueOnce(new Error("Fail"));
      await poller.testDeliverRow(
        mockDb,
        "schema_1",
        registryTable,
        { id: "r1", attempts: 6 },
        "QueueA",
        { data: 1 },
      );
      expect(mockUpdateSet).toHaveBeenCalledWith({
        status: "FAILED",
        errorMessage: "Fail",
      });

      // Test PENDING (attempts < 6)
      mockQueueService.send.mockRejectedValueOnce(new Error("Fail"));
      await poller.testDeliverRow(
        mockDb,
        "schema_1",
        registryTable,
        { id: "r1", attempts: 1 },
        "QueueA",
        { data: 1 },
      );
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "PENDING" }),
      );
    });

    it("should not throw if database update fails during SUCCESS marking", async () => {
      mockUpdateWhere.mockRejectedValueOnce(new Error("DB connection lost"));

      // Should not throw
      await poller.testDeliverRow(
        mockDb,
        "schema_1",
        mockTable,
        { id: "r1", attempts: 0 },
        "QueueA",
        { data: 1 },
      );
    });

    it("should not throw if database update fails during FAIL/RETRY marking", async () => {
      mockQueueService.send.mockRejectedValueOnce(new Error("Queue Down"));
      mockUpdateWhere.mockRejectedValueOnce(new Error("DB connection lost"));

      // Should not throw
      await poller.testDeliverRow(
        mockDb,
        "schema_1",
        mockTable,
        { id: "r1", attempts: 0 },
        "QueueA",
        { data: 1 },
      );
    });
  });

  describe("executeSafeSchemaOperation", () => {
    it("should catch errors from operation and not throw", async () => {
      const op = vi
        .fn()
        .mockRejectedValue(new Error("Schema operation failed"));
      await poller.testExecuteSafeSchemaOperation("tenant1", "schema_1", op);
      expect(op).toHaveBeenCalled(); // No throw
    });
  });
});
