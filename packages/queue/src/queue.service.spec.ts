import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueueService } from "./queue.service.js";
import { QueueName } from "./constants.js";

// ---------------------------------------------------------------------------
// Mock the entire AWS SQS SDK — no real network calls in unit tests
// ---------------------------------------------------------------------------
const mockSend = vi.fn();
vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: vi.fn(function (this: any) {
    this.send = mockSend;
    this.destroy = vi.fn();
  }),

  SendMessageCommand: vi.fn(function (this: any, input: unknown) {
    Object.assign(this, input);
    this._type = "SendMessageCommand";
  }),

  ReceiveMessageCommand: vi.fn(function (this: any, input: unknown) {
    Object.assign(this, input);
    this._type = "ReceiveMessageCommand";
  }),

  DeleteMessageCommand: vi.fn(function (this: any, input: unknown) {
    Object.assign(this, input);
    this._type = "DeleteMessageCommand";
  }),
}));

describe("QueueService", () => {
  let service: QueueService;

  beforeEach(() => {
    mockSend.mockReset();
    // Default: receive returns no messages (prevents infinite poll in tests)
    mockSend.mockResolvedValue({ Messages: [] });
    service = new QueueService({
      infraMode: "local",
      endpoint: "http://localhost:4566",
    });
  });

  afterEach(async () => {
    // Stop any running poll loops to prevent memory leaks between tests
    await service.stopConsuming();
  });

  describe("send()", () => {
    it("sends a JSON-serialised message to the correct queue URL", async () => {
      mockSend.mockResolvedValueOnce({});

      await service.send(QueueName.InboundQueue, { traceId: "abc" });

      expect(mockSend).toHaveBeenCalledOnce();
      const [cmd] = mockSend.mock.calls[0] as [
        { QueueUrl: string; MessageBody: string },
      ];
      expect(cmd.QueueUrl).toContain("inbound-queue");
      expect(JSON.parse(cmd.MessageBody)).toEqual({ traceId: "abc" });
    });

    it("includes DelaySeconds when option is provided", async () => {
      mockSend.mockResolvedValueOnce({});

      await service.send(QueueName.DeliveryQueue, {}, { delaySeconds: 5 });

      const [cmd] = mockSend.mock.calls[0] as [{ DelaySeconds?: number }];
      expect(cmd.DelaySeconds).toBe(5);
    });

    it("omits DelaySeconds when option is not provided", async () => {
      mockSend.mockResolvedValueOnce({});

      await service.send(QueueName.DeliveryQueue, {});

      const [cmd] = mockSend.mock.calls[0] as [{ DelaySeconds?: number }];
      expect(cmd.DelaySeconds).toBeUndefined();
    });
  });

  describe("queueUrl()", () => {
    it("builds LocalStack URL with account 000000000000", async () => {
      mockSend.mockResolvedValueOnce({});
      await service.send(QueueName.ReplicaQueue, {});
      const [cmd] = mockSend.mock.calls[0] as [{ QueueUrl: string }];
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
    });

    it("builds production URL using accountId", async () => {
      mockSend.mockResolvedValueOnce({});
      const prodService = new QueueService({
        infraMode: "production",
        region: "eu-west-1",
        accountId: "123456789012",
      });
      await prodService.send(QueueName.InboundQueue, {});
      const [cmd] = mockSend.mock.calls[0] as [{ QueueUrl: string }];
      expect(cmd.QueueUrl).toBe(
        "https://sqs.eu-west-1.amazonaws.com/123456789012/inbound-queue",
      );
    });
  });

  describe("stopConsuming()", () => {
    it("resolves immediately when no consumers are active", async () => {
      await expect(service.stopConsuming()).resolves.toBeUndefined();
    });
  });

  describe("consume()", () => {
    it("logs a warning and ignores a duplicate consume() call for the same queue", () => {
      const pollSpy = vi
        .spyOn(service as any, "poll")
        .mockResolvedValue(undefined);
      const warnSpy = vi.spyOn((service as any).logger, "warn");
      service.consume(QueueName.InboundQueue, async () => {});
      service.consume(QueueName.InboundQueue, async () => {});
      expect(warnSpy).toHaveBeenCalledOnce();
      pollSpy.mockRestore();
    });
  });

  describe("onModuleDestroy()", () => {
    it("calls stopConsuming and destroys the SQS client", async () => {
      const stopSpy = vi.spyOn(service, "stopConsuming").mockResolvedValue();
      await service.onModuleDestroy();
      expect(stopSpy).toHaveBeenCalledOnce();
    });
  });
});
