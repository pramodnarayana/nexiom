import { describe, it, expect, vi, beforeEach } from "vitest";
import { RoutingDecisionEngine } from "./routing-decision.engine.js";
import { RoutingRepositoryPort } from "../shared/ports/routing.repository.port.js";

describe("RoutingDecisionEngine", () => {
  let engine: RoutingDecisionEngine;
  let mockRepo: RoutingRepositoryPort;

  beforeEach(() => {
    mockRepo = {
      hasNormalizedRecord: vi.fn(),
      getReplicaIdByTraceId: vi.fn(),
      hasSupersedingNormalizedRecord: vi.fn(),
    };
    engine = new RoutingDecisionEngine(mockRepo);
  });

  it("should return found if normalized entity exists", async () => {
    vi.mocked(mockRepo.hasNormalizedRecord).mockResolvedValue(true);

    const result = await engine.evaluateSuperseded("trace-1", "schema-1");

    expect(result).toEqual({ kind: "found" });
    expect(mockRepo.hasNormalizedRecord).toHaveBeenCalledWith("trace-1", "schema-1", undefined);
    expect(mockRepo.getReplicaIdByTraceId).not.toHaveBeenCalled();
  });

  it("should return superseded if normalized entity doesn't exist but another trace normalized it", async () => {
    vi.mocked(mockRepo.hasNormalizedRecord).mockResolvedValue(false);
    vi.mocked(mockRepo.getReplicaIdByTraceId).mockResolvedValue("replica-1");
    vi.mocked(mockRepo.hasSupersedingNormalizedRecord).mockResolvedValue(true);

    const result = await engine.evaluateSuperseded("trace-1", "schema-1");

    expect(result).toEqual({ kind: "superseded" });
    expect(mockRepo.hasNormalizedRecord).toHaveBeenCalledWith("trace-1", "schema-1", undefined);
    expect(mockRepo.getReplicaIdByTraceId).toHaveBeenCalledWith("trace-1", "schema-1", undefined);
    expect(mockRepo.hasSupersedingNormalizedRecord).toHaveBeenCalledWith("replica-1", "trace-1", "schema-1", undefined);
  });

  it("should throw error if normalized entity doesn't exist and no superseding trace exists", async () => {
    vi.mocked(mockRepo.hasNormalizedRecord).mockResolvedValue(false);
    vi.mocked(mockRepo.getReplicaIdByTraceId).mockResolvedValue("replica-1");
    vi.mocked(mockRepo.hasSupersedingNormalizedRecord).mockResolvedValue(false);

    await expect(engine.evaluateSuperseded("trace-1", "schema-1")).rejects.toThrow(
      /not found and no superseding record exists/
    );
  });

  it("should throw error if replica record doesn't exist at all", async () => {
    vi.mocked(mockRepo.hasNormalizedRecord).mockResolvedValue(false);
    vi.mocked(mockRepo.getReplicaIdByTraceId).mockResolvedValue(null);

    await expect(engine.evaluateSuperseded("trace-1", "schema-1")).rejects.toThrow(
      /not found and no superseding record exists/
    );
  });
});
