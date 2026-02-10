/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { runPIICleanup } from "./pii-cleanup";
import { Logger } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";

const mkDb = () => {
  const updateMock = vi.fn();
  const selectMock = vi.fn();

  return {
    update: updateMock,
    select: selectMock,
  } as unknown as NodePgDatabase<typeof schema>;
};

describe("runPIICleanup", () => {
  let db: NodePgDatabase<typeof schema>;
  let logger: Logger;

  beforeEach(() => {
    db = mkDb();
    logger = {
      log: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
  });

  it("should anonymize old sessions in batches and log count", async () => {
    // Mock select to return batches
    const mockSessions1 = Array.from({ length: 10 }, (_, i) => ({
      id: `batch1-${i}`,
    }));
    const mockSessions2 = Array.from({ length: 5 }, (_, i) => ({
      id: `batch2-${i}`,
    }));

    const selectMock = db.select as unknown as Mock;
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValueOnce(mockSessions1) // First batch
        .mockResolvedValueOnce(mockSessions2) // Second batch
        .mockResolvedValueOnce([]), // End of data
    });

    // Mock update execution
    const updateMock = db.update as unknown as Mock;
    const returningMock = vi
      .fn()
      .mockResolvedValueOnce(mockSessions1.map((s) => ({ id: s.id }))) // First batch: 10 sessions
      .mockResolvedValueOnce(mockSessions2.map((s) => ({ id: s.id }))); // Second batch: 5 sessions

    updateMock.mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: returningMock,
    } as any);

    await runPIICleanup(db, logger);

    // Verify SELECT where clause (filtering for old sessions)
    // We can check the structure of the where clause or check that it was called
    // Since we are mocking the chain, we check what was passed to .where()
    // The chain is: select().from().where().limit()
    const selectChain = selectMock.mock.results[0].value as {
      where: Mock;
    };

    expect(selectChain.where).toHaveBeenCalled();

    // Verify UPDATE set and where
    expect(db.update).toHaveBeenCalledWith(schema.session);

    // We can inspect the calls to .set() and .where() on the update chain
    const updateChainInitial = updateMock.mock.results[0].value as {
      set: Mock;
      where: Mock;
    };
    expect(updateChainInitial.set).toHaveBeenCalledWith({
      ipAddress: null,
      userAgent: null,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      updatedAt: expect.any(Date),
    });

    // Verify update where clause (batching by IDs)
    // We expect 2 calls to update (one per batch)
    expect(db.update).toHaveBeenCalledTimes(2);

    // Check where was called once per batch
    // Note: since mockReturnValue returns the same chain object for all update() calls,
    // the where mock accumulates calls across both batches
    expect(updateChainInitial.where).toHaveBeenCalledTimes(2);

    // Expect logger to log start and total count
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("Starting PII Cleanup"),
    );
    expect(logger.log).toHaveBeenCalledWith(
      "PII Cleanup complete. Anonymized 15 sessions.",
    );
  });

  it("should log error and rethrow on failure", async () => {
    const error = new Error("DB Connection Error");

    // Mock select failure
    const selectMock = db.select as unknown as Mock;
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(error),
    });

    await expect(runPIICleanup(db, logger)).rejects.toThrow(
      "DB Connection Error",
    );

    expect(logger.error).toHaveBeenCalledWith(
      "PII Cleanup failed",
      error.stack,
    );
  });

  it("should handle non-Error objects thrown during cleanup", async () => {
    const error = "Unexpected String Error";

    const selectMock = db.select as unknown as Mock;
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(error),
    });

    await expect(runPIICleanup(db, logger)).rejects.toBe(error);

    expect(logger.error).toHaveBeenCalledWith("PII Cleanup failed", undefined);
  });
});
