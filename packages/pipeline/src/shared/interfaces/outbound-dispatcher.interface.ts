export interface DispatchOptions {
  targetObject: string;
  payload: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface DispatchResponse {
  body: Record<string, unknown>;
  entityId?: string;
  statusCode: number;
  sentPayload?: Record<string, unknown>;
  retry?: boolean;
}

export interface IOutboundDispatcher {
  dispatch(
    targetAppName: string,
    options: DispatchOptions,
  ): Promise<DispatchResponse>;
}
