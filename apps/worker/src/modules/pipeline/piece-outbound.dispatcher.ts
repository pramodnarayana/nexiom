import { Injectable } from "@nestjs/common";
import {
  IOutboundDispatcher,
  DispatchOptions,
  DispatchResponse,
} from "./interfaces/outbound-dispatcher.interface.js";
import { PieceRegistryService } from "@soopa/piece-registry";

@Injectable()
export class PieceOutboundDispatcher implements IOutboundDispatcher {
  constructor(private readonly pieceRegistry: PieceRegistryService) {}

  async dispatch(
    targetAppName: string,
    options: DispatchOptions,
  ): Promise<DispatchResponse> {
    const piece = this.pieceRegistry.getPiece(targetAppName);
    if (!piece) {
      throw new Error(`Piece ${targetAppName} not registered`);
    }
    if (!piece.executeAction) {
      throw new Error(`Piece ${targetAppName} has no executeAction defined`);
    }

    const resp = await piece.executeAction(
      options.targetObject,
      options.payload,
      options.credentials,
    );

    return {
      body: resp.body ?? {},
      entityId: resp.entityId,
      statusCode: resp.statusCode ?? 200,
      sentPayload: resp.sentPayload,
      retry: resp.retry,
    };
  }
}
