import { Action } from './action.js';
import { PieceAuthProperty } from './auth.js';

export interface Piece {
    name: string;
    displayName: string;
    logoUrl: string;
    auth?: PieceAuthProperty;
    actions: Record<string, Action>;
    triggers: Record<string, any>; // Triggers not yet implemented in Phase 1
    description: string;
    minimumSupportedRelease?: string;
    maximumSupportedRelease?: string;
}

export interface CreatePieceParams {
    name: string;
    displayName: string;
    logoUrl: string;
    auth?: PieceAuthProperty;
    actions: Action[];
    triggers: any[]; // Triggers not yet implemented in Phase 1
    description?: string;
    minimumSupportedRelease?: string;
    maximumSupportedRelease?: string;
}

/**
 * Mocks the exact Activepieces createPiece function.
 * Bundles the Auth definition, styling metadata, and executable Actions into a single registry object.
 */
export function createPiece(params: CreatePieceParams): Piece {
    // Convert Action array to a Record for O(1) invocation lookups
    const actionsMap = params.actions.reduce(
        (acc, action) => {
            acc[action.name] = action;
            return acc;
        },
        {} as Record<string, Action>,
    );

    return {
        name: params.name,
        displayName: params.displayName,
        logoUrl: params.logoUrl,
        auth: params.auth,
        actions: actionsMap,
        triggers: {}, // Stubbed for now
        description: params.description || '',
        minimumSupportedRelease: params.minimumSupportedRelease,
        maximumSupportedRelease: params.maximumSupportedRelease,
    };
}
