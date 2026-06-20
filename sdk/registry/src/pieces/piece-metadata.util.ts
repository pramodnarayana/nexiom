export interface ExtractedPieceMetadata {
  name: string;
  displayName: string;
  logoUrl?: string;
  description?: string;
  categories?: string[];
  authType?: string;
  authSchema?: Record<string, unknown>;
  aliases?: Record<string, unknown>[];
}

/**
 * Extracts standard metadata from a dynamically imported Piece module.
 * This ensures identical parsing logic whether loaded from NPM (worker) or local workspace (dev mode).
 * 
 * @param moduleExports The raw object returned by import() or require()
 * @returns The extracted metadata, or null if no valid piece was found
 */
export function extractPieceMetadata(moduleExports: Record<string, unknown>): ExtractedPieceMetadata | null {
  let piece: Record<string, unknown> | undefined;

  // 1. Try standard explicit paths
  if (moduleExports.piece && typeof moduleExports.piece === 'object') {
    piece = moduleExports.piece as Record<string, unknown>;
  }

  if (!piece) {
    let registerFn = moduleExports.register;
    if (
      typeof registerFn !== "function" &&
      moduleExports.default &&
      typeof (moduleExports.default as Record<string, unknown>).register === "function"
    ) {
      registerFn = (moduleExports.default as Record<string, unknown>).register;
    }

    if (typeof registerFn === "function") {
      try {
          piece = (registerFn as () => Record<string, unknown>)();
      } catch (e) {
          // ignore
      }
    }
  }

  if (!piece && moduleExports.default && typeof moduleExports.default === 'object') {
    piece = moduleExports.default as Record<string, unknown>;
  }

  // 2. Fallback: scan all exports for something that looks like a Piece
  if (!piece || typeof piece.name !== 'string' || typeof piece.displayName !== 'string') {
    for (const [key, val] of Object.entries(moduleExports)) {
      let maybePiece = val;
      if (typeof val === 'function' && key === 'register') {
        try {
          maybePiece = val();
        } catch (e) {
          // ignore
        }
      }

      if (key === 'default' && val !== null && typeof val === 'object') {
        const defaultObj = val as Record<string, unknown>;
        if (typeof defaultObj.register === 'function') {
          try {
            maybePiece = defaultObj.register();
          } catch (e) {
            // ignore
          }
        }
      }

      if (typeof maybePiece === 'object' && maybePiece !== null && 'name' in maybePiece && 'displayName' in maybePiece) {
        piece = maybePiece as Record<string, unknown>;
        break;
      }
    }
  }

  if (
    !piece ||
    typeof piece.name !== "string" ||
    typeof piece.displayName !== "string"
  ) {
    return null;
  }

  // Validate auth.type is actually a string
  let authType: string | undefined;
  if (piece.auth && typeof piece.auth === "object" && "type" in piece.auth) {
    authType = typeof piece.auth.type === "string" ? piece.auth.type : undefined;
  }

  // Validate auth.props is actually an object/Record
  let authSchema: Record<string, unknown> | undefined;
  if (authType && piece.auth && typeof piece.auth === "object" && "props" in piece.auth) {
    const props = piece.auth.props;
    authSchema = (typeof props === "object" && props !== null && !Array.isArray(props)) ? (props as Record<string, unknown>) : undefined;
  }

  return {
    name: piece.name,
    displayName: piece.displayName,
    logoUrl: typeof piece.logoUrl === "string" ? piece.logoUrl : undefined,
    description: typeof piece.description === "string" ? piece.description : undefined,
    categories: Array.isArray(piece.categories) && piece.categories.every((c) => typeof c === "string") ? piece.categories : undefined,
    authType,
    authSchema,
    aliases: Array.isArray(piece.aliases) && piece.aliases.every((a) => typeof a === "object" && a !== null && !Array.isArray(a)) ? piece.aliases : undefined,
  };
}
