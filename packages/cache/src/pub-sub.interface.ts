export interface IPubSub {
  subscribe(channel: string): Promise<void>;
  onMessage(callback: (channel: string, message: string) => void): void;
  quit(): Promise<void>;
}
