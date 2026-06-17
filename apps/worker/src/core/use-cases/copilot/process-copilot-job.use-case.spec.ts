import { describe, it, expect, beforeEach } from "vitest";
import { ProcessCopilotJobUseCase } from "./process-copilot-job.use-case.js";
import {
  FakeChatStreamOrchestrator,
  FakeRealtimeEventPubSub,
  FakeChatPersistence,
  FakeTitleGenerator,
} from "../../fakes/copilot-ports.fake.js";

describe("ProcessCopilotJobUseCase", () => {
  let orchestrator: FakeChatStreamOrchestrator;
  let pubSub: FakeRealtimeEventPubSub;
  let persistence: FakeChatPersistence;
  let titleGenerator: FakeTitleGenerator;
  let useCase: ProcessCopilotJobUseCase;

  beforeEach(() => {
    orchestrator = new FakeChatStreamOrchestrator();
    pubSub = new FakeRealtimeEventPubSub();
    persistence = new FakeChatPersistence();
    titleGenerator = new FakeTitleGenerator();

    useCase = new ProcessCopilotJobUseCase(
      orchestrator,
      pubSub,
      persistence,
      titleGenerator,
    );
  });

  it("should stream chat, parse messages, and save to persistence", async () => {
    orchestrator.chunksToYield = [
      '0:"Hello"\n',
      '0:" World"\n',
      '8:{"functionCall": "get_data"}\n',
    ];

    await useCase.execute({
      jobId: "job-1",
      traceId: "trace-1",
      tenantId: "tenant-1",
      conversationId: "conv-1",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(pubSub.parts.length).toBe(3);
    expect(pubSub.dones).toContain("job-1");

    expect(persistence.appendedMessages).toHaveLength(2);

    // The human text message
    expect(persistence.appendedMessages[0]).toEqual({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      role: "assistant",
      content: "Hello World",
      status: "completed",
    });

    // The system metadata message
    expect(persistence.appendedMessages[1]).toEqual({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      role: "system",
      content: JSON.stringify({ steps: [{ functionCall: "get_data" }] }),
      status: "completed",
    });
  });

  it("should generate a title if it is the first user message", async () => {
    orchestrator.chunksToYield = [];

    await useCase.execute({
      jobId: "job-1",
      traceId: "trace-1",
      tenantId: "tenant-1",
      conversationId: "conv-1",
      messages: [{ role: "user", content: "Can you help me?" }],
    });

    // Wait for the fire-and-forget title generator
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(persistence.titles).toHaveLength(1);
    expect(persistence.titles[0]).toEqual({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      title: "A fake title",
    });
  });

  it("should publish error and rethrow if orchestration fails", async () => {
    orchestrator.shouldFail = true;

    await expect(
      useCase.execute({
        jobId: "job-1",
        traceId: "trace-1",
        tenantId: "tenant-1",
        conversationId: "conv-1",
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toThrow("Orchestration failed");

    expect(pubSub.errors).toHaveLength(1);
    expect(pubSub.errors[0].jobId).toBe("job-1");
    expect(pubSub.dones).toContain("job-1");
  });

  it("should handle title generation failure gracefully", async () => {
    orchestrator.chunksToYield = [];
    titleGenerator.generateTitle = async () => {
      await Promise.resolve();
      throw new Error("Title generation failed");
    };

    await useCase.execute({
      jobId: "job-1",
      traceId: "trace-1",
      tenantId: "tenant-1",
      conversationId: "conv-1",
      messages: [{ role: "user", content: "Hi" }],
    });

    // Wait for the fire-and-forget title generator
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(persistence.titles).toHaveLength(0); // Should not have saved a title
  });
});
