import { Injectable, Inject, OnModuleDestroy, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './cache.module.js';
import type { IPubSub } from './pub-sub.interface.js';

@Injectable()
export class RedisPubSubService implements IPubSub, OnModuleDestroy {
  private readonly logger = new Logger(RedisPubSubService.name);
  private readonly subscriber: Redis;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    // Create a dedicated connection for Pub/Sub since a connection in Pub/Sub mode
    // cannot issue other commands.
    this.subscriber = this.redis.duplicate();
  }

  async subscribe(channel: string): Promise<void> {
    await this.subscriber.subscribe(channel);
  }

  onMessage(callback: (channel: string, message: string) => void): void {
    this.subscriber.on('message', callback);
  }

  async quit(): Promise<void> {
    await this.subscriber.quit();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.quit();
    } catch (err) {
      this.logger.warn(`Failed to quit pub/sub client gracefully: ${String(err)}`);
    }
  }
}
