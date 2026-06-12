import { Injectable, Inject } from '@nestjs/common';
import { BaseOAuthRefreshClient } from '@soopa/credentials';
import { ENCRYPTION_SERVICE, type IEncryptionService } from '@soopa/security';
import { PropertyType } from '@soopa/piece-framework';
import { DATABASE_CONNECTION, type DrizzleDb } from '@soopa/database';
import { PieceRegistryService } from '@soopa/piece-registry';

@Injectable()
export class RegistryOAuthRefreshClient extends BaseOAuthRefreshClient {
  constructor(
    private readonly pieceRegistry: PieceRegistryService,
    @Inject(DATABASE_CONNECTION) db: DrizzleDb,
    @Inject(ENCRYPTION_SERVICE) crypto: IEncryptionService,
  ) {
    super(db, crypto);
  }

  protected getTokenUrl(appName: string): string {
    const piece = this.pieceRegistry.getPiece(appName);
    if (!piece) {
      throw new Error(`Piece not found for refresh: ${appName}`);
    }

    if (piece.auth?.type !== PropertyType.OAUTH2 || !piece.auth.tokenUrl) {
      throw new Error(
        `Piece ${appName} does not support OAuth refresh or lacks a token url`,
      );
    }

    return piece.auth.tokenUrl;
  }
}
