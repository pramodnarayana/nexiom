import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ICredentialsEventPublisher } from '../interfaces/index.js';
import type { CredentialInvalidatedEvent, CredentialRefreshedEvent, CredentialDeletedEvent } from '../events/index.js';

@Injectable()
export class CredentialsEventPublisher implements ICredentialsEventPublisher {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  async publishCredentialInvalidated(event: CredentialInvalidatedEvent): Promise<void> {
    await this.eventEmitter.emitAsync('credential.invalidated', event);
  }

  async publishCredentialRefreshed(event: CredentialRefreshedEvent): Promise<void> {
    await this.eventEmitter.emitAsync('credential.refreshed', event);
  }

  async publishCredentialDeleted(event: CredentialDeletedEvent): Promise<void> {
    await this.eventEmitter.emitAsync('credential.deleted', event);
  }
}
