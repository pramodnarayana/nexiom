import { Injectable, Inject } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { RealtimeEventPubSubPort } from "../../core/ports/outbound/copilot-ports.js";

@Injectable()
export class RedisRealtimeEventPubSubAdapter implements RealtimeEventPubSubPort {
  constructor(@Inject("REDIS_CLIENT") private readonly redis: Redis) {}

  async publishStreamPart(jobId: string, chunk: string): Promise<void> {
    await this.redis.publish(
      `copilot:${jobId}`,
      JSON.stringify({ type: "stream", payload: chunk }),
    );
  }

  async publishError(jobId: string, errorMessage: string): Promise<void> {
    await this.redis.publish(
      `copilot:${jobId}`,
      JSON.stringify({ type: "error", payload: errorMessage }),
    );
  }

  async publishDone(jobId: string): Promise<void> {
    await this.redis.publish(
      `copilot:${jobId}`,
      JSON.stringify({ type: "done", payload: "done" }),
    );
  }
}
