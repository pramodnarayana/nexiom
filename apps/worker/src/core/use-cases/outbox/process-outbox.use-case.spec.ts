import { describe, it, expect, beforeEach } from "vitest";
import { QueueName } from "@soopa/queue";
import { ProcessOutboxUseCase } from "./process-outbox.use-case.js";
import { FakeOutboxRepository } from "../../fakes/fake-outbox.repository.js";
import { FakeQueuePublisher } from "../../fakes/fake-queue.publisher.js";

describe("ProcessOutboxUseCase", () => {
  let repository: FakeOutboxRepository;
  let publisher: FakeQueuePublisher;
  let useCase: ProcessOutboxUseCase;

  beforeEach(() => {
    repository = new FakeOutboxRepository();
    publisher = new FakeQueuePublisher();
    useCase = new ProcessOutboxUseCase(repository, publisher, {
      batchSize: 10,
      maxAttempts: 3,
      queueName: QueueName.InboundQueue,
    });
  });

  it("should process pending rows and mark them as SUCCESS", async () => {
    repository.addRows([
      { id: "row-1", attempts: 0, payload: { foo: "bar" } },
      { id: "row-2", attempts: 0, payload: { fizz: "buzz" } },
    ]);

    await useCase.execute("tenant-1", "schema-1");

    expect(publisher.messages.length).toBe(2);
    expect(publisher.messages[0].payload).toEqual({ foo: "bar" });
    expect(publisher.messages[1].payload).toEqual({ fizz: "buzz" });

    expect(repository.statuses.get("row-1")).toBe("SUCCESS");
    expect(repository.statuses.get("row-2")).toBe("SUCCESS");
  });

  it("should map payload if payloadMapper is provided", async () => {
    const mappedUseCase = new ProcessOutboxUseCase(repository, publisher, {
      batchSize: 10,
      maxAttempts: 3,
      queueName: QueueName.InboundQueue,
      payloadMapper: (row) => ({ customTraceId: row.traceId }),
    });

    repository.addRows([{ id: "row-1", attempts: 0, traceId: "t-123" }]);

    await mappedUseCase.execute("tenant-1", "schema-1");

    expect(publisher.messages[0].payload).toEqual({ customTraceId: "t-123" });
  });

  it("should mark as RETRY if queue publisher fails and attempts < maxAttempts", async () => {
    repository.addRows([{ id: "row-1", attempts: 1, payload: {} }]);
    publisher.shouldFail = true;

    await useCase.execute("tenant-1", "schema-1");

    expect(repository.statuses.get("row-1")).toBe("RETRY");
    expect(repository.retries.get("row-1")).toBe(1); // the attempt that just failed
  });

  it("should mark as FAIL if queue publisher fails and attempts >= maxAttempts", async () => {
    repository.addRows([
      { id: "row-1", attempts: 3, payload: {} }, // Max is 3
    ]);
    publisher.shouldFail = true;

    await useCase.execute("tenant-1", "schema-1");

    expect(repository.statuses.get("row-1")).toBe("FAIL");
  });

  it("should gracefully handle database errors when marking success", async () => {
    repository.addRows([{ id: "row-1", attempts: 0, payload: {} }]);
    repository.shouldFailMarkSuccess = true;

    await expect(
      useCase.execute("tenant-1", "schema-1"),
    ).resolves.not.toThrow();

    // It published to queue, but DB update threw. The status remains PROCESSING from the claim step.
    expect(publisher.messages.length).toBe(1);
    expect(repository.statuses.get("row-1")).toBe("PROCESSING");
  });

  it("should gracefully handle database errors when marking retry/failure", async () => {
    repository.addRows([{ id: "row-1", attempts: 1, payload: {} }]);
    publisher.shouldFail = true;
    repository.shouldFailMarkFailure = true;

    await expect(
      useCase.execute("tenant-1", "schema-1"),
    ).resolves.not.toThrow();

    // Publisher threw, then DB threw when marking retry.
    expect(repository.statuses.get("row-1")).toBe("PROCESSING");
  });
});
