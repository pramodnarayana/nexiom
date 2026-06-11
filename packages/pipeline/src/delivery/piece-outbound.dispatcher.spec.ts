import { describe, it, expect } from "vitest";
import { PieceOutboundDispatcher } from "./piece-outbound.dispatcher.js";
import { PieceRegistryService } from "@soopa/piece-registry";

describe("PieceOutboundDispatcher", () => {
  it("should throw if piece not registered", async () => {
    const registry = new PieceRegistryService([]);
    const dispatcher = new PieceOutboundDispatcher(registry);

    await expect(
      dispatcher.dispatch("unknown-app", {
        targetObject: "contact",
        payload: { name: "test" },
        credentials: { accessToken: "token" },
      })
    ).rejects.toThrow("Piece unknown-app not registered");
  });

  it("should throw if piece has no executeAction", async () => {
    const registry = new PieceRegistryService([{
      name: "test-app",
      logoUrl: "",
      displayName: "",
      description: "",
      supportedTriggers: [],
      supportedActions: [],
      supportedAuthTypes: [],
      // missing executeAction
    } as any]);

    const dispatcher = new PieceOutboundDispatcher(registry);

    await expect(
      dispatcher.dispatch("test-app", {
        targetObject: "contact",
        payload: { name: "test" },
        credentials: { accessToken: "token" },
      })
    ).rejects.toThrow("Piece test-app has no executeAction defined");
  });

  it("should dispatch and return formatted response", async () => {
    const registry = new PieceRegistryService([{
      name: "test-app",
      logoUrl: "",
      displayName: "",
      description: "",
      supportedTriggers: [],
      supportedActions: [],
      supportedAuthTypes: [],
      executeAction: async (targetObject: any, payload: any, credentials: any) => {
        return {
          body: { id: "123", ...payload },
          entityId: "123",
          statusCode: 201,
          sentPayload: payload,
          retry: false,
        };
      },
    } as any]);

    const dispatcher = new PieceOutboundDispatcher(registry);

    const result = await dispatcher.dispatch("test-app", {
      targetObject: "contact",
      payload: { name: "test" },
      credentials: { accessToken: "token" },
    });

    expect(result).toEqual({
      body: { id: "123", name: "test" },
      entityId: "123",
      statusCode: 201,
      sentPayload: { name: "test" },
      retry: false,
    });
  });

  it("should default statusCode and body if not provided", async () => {
    const registry = new PieceRegistryService([{
      name: "test-app",
      logoUrl: "",
      displayName: "",
      description: "",
      supportedTriggers: [],
      supportedActions: [],
      supportedAuthTypes: [],
      executeAction: async () => {
        return {
          entityId: "123",
        };
      },
    } as any]);

    const dispatcher = new PieceOutboundDispatcher(registry);

    const result = await dispatcher.dispatch("test-app", {
      targetObject: "contact",
      payload: {},
      credentials: {},
    });

    expect(result).toEqual({
      body: {},
      entityId: "123",
      statusCode: 200,
      sentPayload: undefined,
      retry: undefined,
    });
  });
});
