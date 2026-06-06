import type { CredentialInvalidatedEvent, CredentialRefreshedEvent, CredentialDeletedEvent } from '../events/index.js';

export interface ICredentialsEventPublisher {
  publishCredentialInvalidated(event: CredentialInvalidatedEvent): Promise<void> | void;
  publishCredentialRefreshed(event: CredentialRefreshedEvent): Promise<void> | void;
  publishCredentialDeleted(event: CredentialDeletedEvent): Promise<void> | void;
}
