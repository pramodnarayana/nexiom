import { Logger } from "@nestjs/common";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueueService } from "./queue.service.js";
import { QueueName } from "./constants.js";

// ---------------------------------------------------------------------------
// Typed shapes for mock command objects and SQS responses
// ---------------------------------------------------------------------------

interface MockCommand {
  _type:
    | "SendMessageCommand"
    | "ReceiveMessageCommand"
    | "DeleteMessageCommand";
  QueueUrl?: string;
  MessageBody?: string;
  DelaySeconds?: number;
  ReceiptHandle?: string;
  MaxNumberOfMessages?: number;
  WaitTimeSeconds?: number;
}

interface SqsReceiveResult {
  Messages?: Array<{ Body?: string; ReceiptHandle?: string }>;
}

interface MockSqsClientInstance {
  send: typeof mockSend;
  destroy: typeof mockDestroy;
}

// ---------------------------------------------------------------------------
// Module-level mock stubs — reset in beforeEach
// ---------------------------------------------------------------------------

const mockSend = vi.fn<(cmd: MockCommand) => Promise<SqsReceiveResult>>();
const mockDestroy = vi.fn();

// ---------------------------------------------------------------------------
// Module mock
// Constructor functions must use `function` (not arrow) so Vitest can call
// them with `new`. The `this` parameter is typed via the interfaces above —
// no `any` leaks into the test assertions below.
// ---------------------------------------------------------------------------

vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: vi.fn(function (this: MockSqsClientInstance) {
    this.send = mockSend;
    this.destroy = mockDestroy;
  }),
  SendMessageCommand: vi.fn(function (
    this: MockCommand,
    input: Partial<MockCommand>,
  ) {
    Object.assign(this, input);
    this._type = "SendMessageCommand";
  }),
  ReceiveMessageCommand: vi.fn(function (
    this: MockCommand,
    input: Partial<MockCommand>,
  ) {
    Object.assign(this, input);
    this._type = "ReceiveMessageCommand";
  }),
  DeleteMessageCommand: vi.fn(function (
    this: MockCommand,
    input: Partial<MockCommand>,
  ) {
    Object.assign(this, input);
    this._type = "DeleteMessageCommand";
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QueueService", () => {
  let service: QueueService;

  beforeEach(() => {
    mockSend.mockReset();
    mockDestroy.mockReset();
    // Default: receive returns no messages (prevents tight poll loop in tests)
    mockSend.mockResolvedValue({ Messages: [] });
    service = new QueueService({
      infraMode: "local",
      endpoint: "http://localhost:4566",
    });
  });

  afterEach(async () => {
    await service.stopConsuming();
  });

  // ---------------------------------------------------------------------------
  // send()
  // ---------------------------------------------------------------------------

  describe("send()", () => {
    it("sends a JSON-serialised message to the correct queue URL", async () => {
      mockSend.mockResolvedValueOnce({});

      await service.send(QueueName.InboundQueue, { traceId: "abc" });

      expect(mockSend).toHaveBeenCalledOnce();
      const [cmd] = mockSend.mock.calls[0];
      expect(cmd.QueueUrl).toContain("inbound-queue");
      expect(JSON.parse(cmd.MessageBody!)).toEqual({ traceId: "abc" });
    });

    it("includes DelaySeconds when option is provided", async () => {
      mockSend.mockResolvedValueOnce({});

      await service.send(QueueName.DeliveryQueue, {}, { delaySeconds: 5 });

      const [cmd] = mockSend.mock.calls[0];
      expect(cmd.DelaySeconds).toBe(5);
    });

    it("omits DelaySeconds when option is not provided", async () => {
      mockSend.mockResolvedValueOnce({});

      await service.send(QueueName.DeliveryQueue, {});

      const [cmd] = mockSend.mock.calls[0];
      expect(cmd.DelaySeconds).toBeUndefined();
    });

    it("is a no-op and logs debug when enabled is false", async () => {
      const disabledService = new QueueService({
        infraMode: "local",
        endpoint: "http://localhost:4566",
        enabled: false,
      });
      const debugSpy = vi.spyOn(Logger.prototype, "debug");

      await disabledService.send(QueueName.InboundQueue, { traceId: "x" });

      expect(mockSend).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("dropping send"),
      );
      debugSpy.mockRestore();
      await disabledService.onModuleDestroy();
    });
  });

  // ---------------------------------------------------------------------------
  // queueUrl() — exercised indirectly via send()
  // ---------------------------------------------------------------------------

  describe("queueUrl()", () => {
    it("builds LocalStack URL with account 000000000000", async () => {
      mockSend.mockResolvedValueOnce({});
      await service.send(QueueName.ReplicaQueue, {});
      const [cmd] = mockSend.mock.calls[0];
      expect(cmd.QueueUrl).toBe(
        "http://localhost:4566/000000000000/replica-queue",
      );
    });

    it("throws when infraMode=production and accountId is missing", async () => {
      const prodService = new QueueService({
        infraMode: "production",
        region: "us-east-1",
      });
      await expect(
        prodService.send(QueueName.InboundQueue, {}),
      ).rejects.toThrow("accountId");
      await prodService.onModuleDestroy();
    });

    it("builds production URL using accountId", async () => {
      mockSend.mockResolvedValueOnce({});
      const prodService = new QueueService({
        infraMode: "production",
        region: "eu-west-1",
        accountId: "123456789012",
      });
      await prodService.send(QueueName.InboundQueue, {});
      const [cmd] = mockSend.mock.calls[0];
      expect(cmd.QueueUrl).toBe(
        "https://sqs.eu-west-1.amazonaws.com/123456789012/inbound-queue",
      );
      await prodService.onModuleDestroy();
    });
  });

  // ---------------------------------------------------------------------------
  // stopConsuming()
  // ---------------------------------------------------------------------------

  describe("stopConsuming()", () => {
    it("resolves immediately when no consumers are active", async () => {
      await expect(service.stopConsuming()).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // consume()
  // ---------------------------------------------------------------------------

  describe("consume()", () => {
    it("logs a warning and ignores a duplicate call for the same queue", () => {
      const warnSpy = vi.spyOn(Logger.prototype, "warn");
      service.consume(QueueName.InboundQueue, async () => {});
      service.consume(QueueName.InboundQueue, async () => {});
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Consumer already running"),
      );
      warnSpy.mockRestore();
    });

    it("is a no-op and logs debug when enabled is false", () => {
      const disabledService = new QueueService({
        infraMode: "local",
        endpoint: "http://localhost:4566",
        enabled: false,
      });
      const debugSpy = vi.spyOn(Logger.prototype, "debug");
      disabledService.consume(QueueName.InboundQueue, async () => {});
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("Queue consumption disabled"),
      );
      // No consumers registered — stopConsuming resolves immediately
      void disabledService.stopConsuming();
      debugSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // poll() and message processing
  // Tested through the public consume() / stopConsuming() API so no private
  // method access or `(service as any)` casts are needed.
  // ---------------------------------------------------------------------------

  describe("poll() / message processing", () => {
    it("logs an error and removes the consumer when maxConcurrent is invalid", async () => {
      const errorSpy = vi.spyOn(Logger.prototype, "error");
      service.consume(QueueName.InboundQueue, async () => {}, {
        maxConcurrent: 0,
      });

      // poll() throws synchronously (async fn → rejected promise); the .catch()
      // handler on pollerPromise runs in the next microtask tick.
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Consumer for"),
        expect.any(Error),
      );

      // Consumer was removed — a second consume() on the same queue must NOT
      // log a duplicate-consumer warning (it would if the first entry remained).
      const warnSpy = vi.spyOn(Logger.prototype, "warn");
      service.consume(QueueName.InboundQueue, async () => {});
      expect(warnSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("dispatches received messages to the handler and deletes them", async () => {
      const handler = vi.fn<(payload: unknown) => Promise<void>>();
      const handlerDone = new Promise<void>((resolve) => {
        handler.mockImplementation((_payload: unknown) => {
          resolve();
          return Promise.resolve();
        });
      });
      mockSend
        .mockResolvedValueOnce({
          Messages: [{ Body: '{"n":42}', ReceiptHandle: "rh-x" }],
        })
        .mockResolvedValue({ Messages: [] });

      service.consume(QueueName.InboundQueue, handler);
      await handlerDone;
      await service.stopConsuming();

      expect(handler).toHaveBeenCalledWith({ n: 42 });
      const commandTypes = mockSend.mock.calls.map(([c]) => c._type);
      expect(commandTypes).toContain("DeleteMessageCommand");
    });

    it("defaults to an empty-object payload when the message Body is absent", async () => {
      const handler = vi.fn<(payload: unknown) => Promise<void>>();
      const handlerDone = new Promise<void>((resolve) => {
        handler.mockImplementation((_payload: unknown) => {
          resolve();
          return Promise.resolve();
        });
      });
      mockSend
        .mockResolvedValueOnce({
          Messages: [{ ReceiptHandle: "rh-nobody" }],
        })
        .mockResolvedValue({ Messages: [] });

      service.consume(QueueName.InboundQueue, handler);
      await handlerDone;
      await service.stopConsuming();

      expect(handler).toHaveBeenCalledWith({});
    });

    it("does not delete the message when the handler rejects", async () => {
      const handler = vi.fn<(payload: unknown) => Promise<void>>();
      const handlerCalled = new Promise<void>((resolve) => {
        handler.mockImplementation((_payload: unknown) => {
          resolve();
          return Promise.reject(new Error("boom"));
        });
      });
      mockSend
        .mockResolvedValueOnce({
          Messages: [{ Body: "{}", ReceiptHandle: "rh-fail" }],
        })
        .mockResolvedValue({ Messages: [] });

      service.consume(QueueName.InboundQueue, handler);
      await handlerCalled;
      await service.stopConsuming();

      const commandTypes = mockSend.mock.calls.map(([c]) => c._type);
      expect(
        commandTypes.filter((t) => t === "DeleteMessageCommand"),
      ).toHaveLength(0);
    });

    it("exits the poll loop cleanly when stopConsuming() fires after a receive", async () => {
      service.consume(QueueName.InboundQueue, async () => {});
      await service.stopConsuming();
      await expect(service.stopConsuming()).resolves.toBeUndefined();
    });

    it("logs a poll error and backs off when the receive call throws", async () => {
      vi.useFakeTimers();
      const errorSpy = vi.spyOn(Logger.prototype, "error");
      try {
        mockSend.mockRejectedValue(new Error("SQS unavailable"));
        service.consume(QueueName.InboundQueue, async () => {});

        // Drain microtasks so the rejection reaches the catch block
        await Promise.resolve();
        await Promise.resolve();

        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining("Poll error"),
          expect.any(Error),
        );

        // Signal loop exit, then fast-forward through the 2 s backoff so the
        // poller resolves before we restore real timers.
        mockSend.mockResolvedValue({ Messages: [] });
        const stopPromise = service.stopConsuming();
        await vi.advanceTimersByTimeAsync(2100);
        await stopPromise;
      } finally {
        errorSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // onModuleDestroy()
  // ---------------------------------------------------------------------------

  describe("onModuleDestroy()", () => {
    it("calls stopConsuming and destroys the SQS client", async () => {
      const stopSpy = vi.spyOn(service, "stopConsuming").mockResolvedValue();
      await service.onModuleDestroy();
      expect(stopSpy).toHaveBeenCalledOnce();
      expect(mockDestroy).toHaveBeenCalledOnce();
    });
  });
});
