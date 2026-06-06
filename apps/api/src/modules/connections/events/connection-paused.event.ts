export class ConnectionPausedEvent {
  constructor(
    public readonly connectionId: string,
    public readonly tenantId: string,
    public readonly reason: string,
  ) {}
}
