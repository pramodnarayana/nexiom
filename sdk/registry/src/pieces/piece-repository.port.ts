export const PIECE_REPOSITORY = Symbol('PIECE_REPOSITORY');

export interface UpsertPieceDto {
  name: string;
  displayName: string;
  packageName: string;
  version: string;
  logoUrl?: string;
}

export interface IPieceRepository {
  /**
   * Upserts a piece definition into the registry storage.
   */
  upsertPiece(dto: UpsertPieceDto): Promise<void>;
}
