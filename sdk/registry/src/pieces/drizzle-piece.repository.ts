import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION, pieces, type DrizzleDb } from '@soopa/database';
import { IPieceRepository, UpsertPieceDto } from './piece-repository.port.js';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DrizzlePieceRepository implements IPieceRepository {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async upsertPiece(dto: UpsertPieceDto): Promise<void> {
    await this.db.insert(pieces).values({
      id: uuidv4(),
      name: dto.name,
      displayName: dto.displayName,
      logoUrl: dto.logoUrl || '',
      packageName: dto.packageName,
      version: dto.version,
      enabled: true,
    }).onConflictDoUpdate({
      target: pieces.name,
      set: {
        displayName: dto.displayName,
        logoUrl: dto.logoUrl || '',
        packageName: dto.packageName,
        version: dto.version,
        updatedAt: new Date()
      }
    });
  }
}
