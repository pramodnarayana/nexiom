import { Module } from '@nestjs/common';
import { GitopsSyncController } from './gitops-sync.controller.js';
import { GitopsWebhookGuard } from './gitops-webhook.guard.js';

@Module({
  controllers: [GitopsSyncController],
  providers: [GitopsWebhookGuard],
})
export class GitopsModule {}
