import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConnectionRepository } from '../../repositories/connection.repository.js';
import { ENCRYPTION_SERVICE, type IEncryptionService } from '@soopa/security';

@Injectable()
export class GetExistingOAuthCredentialsUseCase {
  private readonly logger = new Logger(GetExistingOAuthCredentialsUseCase.name);

  constructor(
    private readonly connectionRepository: ConnectionRepository,
    @Inject(ENCRYPTION_SERVICE) private readonly crypto: IEncryptionService,
  ) {}

  async execute(
    dataSourceId: string,
    tenantId: string,
  ): Promise<{ clientId?: string; clientSecret?: string }> {
    try {
      const creds = await this.connectionRepository.getConnectionCredentials(
        dataSourceId,
        tenantId,
      );

      if (creds && creds.value) {
        const decryptedValue = await this.crypto.decrypt(creds.value);
        const parsedValue = JSON.parse(decryptedValue) as {
          clientId?: string;
          clientSecret?: string;
        };
        return {
          clientId: parsedValue.clientId,
          clientSecret: parsedValue.clientSecret,
        };
      }
    } catch (e) {
      this.logger.warn(
        `Failed to parse existing connection value to extract credentials for reconnect: ${e}`,
      );
    }

    return {};
  }
}
