import { describe, it, expect, vi } from 'vitest';
import { CredentialsEventPublisher } from './credentials-event-publisher.service.js';
import { CredentialInvalidatedEvent, CredentialRefreshedEvent, CredentialDeletedEvent } from '../events/index.js';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('CredentialsEventPublisher', () => {
  it('should publish all events correctly', async () => {
    const eventEmitter = {
      emitAsync: vi.fn(),
    } as unknown as EventEmitter2;

    const publisher = new CredentialsEventPublisher(eventEmitter);

    const invalidated = new CredentialInvalidatedEvent('c1', 'reason', 'app1');
    await publisher.publishCredentialInvalidated(invalidated);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith('credential.invalidated', invalidated);

    const refreshed = new CredentialRefreshedEvent('c1', 't1', 'ds1', new Date());
    await publisher.publishCredentialRefreshed(refreshed);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith('credential.refreshed', refreshed);

    const deleted = new CredentialDeletedEvent('c1', 't1', 'app1');
    await publisher.publishCredentialDeleted(deleted);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith('credential.deleted', deleted);
  });
});
