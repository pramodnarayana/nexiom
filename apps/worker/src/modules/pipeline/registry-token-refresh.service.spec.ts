import { Test, TestingModule } from "@nestjs/testing";
import { RegistryOAuthRefreshClient } from "./registry-token-refresh.service.js";
import { PieceRegistryService } from "@nexiom/piece-registry";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { EncryptionService } from "@nexiom/credentials";
import { PropertyType, Piece } from "@nexiom/piece-framework";

describe("RegistryOAuthRefreshClient", () => {
  let service: RegistryOAuthRefreshClient;
  let pieceRegistry: PieceRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistryOAuthRefreshClient,
        {
          provide: PieceRegistryService,
          useValue: {
            getPiece: vi.fn(),
          },
        },
        {
          provide: DATABASE_CONNECTION,
          useValue: {}, // mock db
        },
        {
          provide: EncryptionService,
          useValue: {}, // mock crypto
        },
      ],
    }).compile();

    service = module.get<RegistryOAuthRefreshClient>(
      RegistryOAuthRefreshClient,
    );
    pieceRegistry = module.get<PieceRegistryService>(PieceRegistryService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getTokenUrl", () => {
    it("should throw an error if the piece is not found", () => {
      vi.spyOn(pieceRegistry, "getPiece").mockReturnValue(undefined);

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (service as any).getTokenUrl("non_existent_piece");
      }).toThrow("Piece not found for refresh: non_existent_piece");
    });

    it("should throw an error if the piece does not support OAuth2", () => {
      vi.spyOn(pieceRegistry, "getPiece").mockReturnValue({
        name: "test_piece",
        auth: {
          type: PropertyType.CUSTOM_AUTH,
        },
      } as unknown as Piece);

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (service as any).getTokenUrl("test_piece");
      }).toThrow(
        "Piece test_piece does not support OAuth refresh or lacks a token url",
      );
    });

    it("should throw an error if the piece supports OAuth2 but lacks a tokenUrl", () => {
      vi.spyOn(pieceRegistry, "getPiece").mockReturnValue({
        name: "test_piece",
        auth: {
          type: PropertyType.OAUTH2,
          // Missing tokenUrl
        },
      } as unknown as Piece);

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (service as any).getTokenUrl("test_piece");
      }).toThrow(
        "Piece test_piece does not support OAuth refresh or lacks a token url",
      );
    });

    it("should return the tokenUrl if the piece supports OAuth2 and provides a tokenUrl", () => {
      vi.spyOn(pieceRegistry, "getPiece").mockReturnValue({
        name: "test_piece",
        auth: {
          type: PropertyType.OAUTH2,
          tokenUrl: "https://api.test.com/oauth/token",
        },
      } as unknown as Piece);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const url = (service as any).getTokenUrl("test_piece");
      expect(url).toBe("https://api.test.com/oauth/token");
    });
  });
});
