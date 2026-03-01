import { Action } from './action.js';
import { PieceAuthProperty } from './auth.js';
import { InternalServerErrorException } from '@nestjs/common';

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
            if (acc[action.name]) {
                throw new InternalServerErrorException(`Duplicate action name: ${action.name}`);
            }
            acc[action.name] = action;
            return acc;
        },
        {} as Record<string, Action>,
    );

    const triggersMap = (params.triggers || []).reduce(
        (acc, trigger) => {
            if (acc[trigger.name]) {
                throw new InternalServerErrorException(`Duplicate trigger name: ${trigger.name}`);
            }
            acc[trigger.name] = trigger;
            return acc;
        },
        {} as Record<string, any>,
    );

    return {
        name: params.name,
        displayName: params.displayName,
        logoUrl: params.logoUrl,
        auth: params.auth,
        actions: actionsMap,
        triggers: triggersMap,
        description: params.description || '',
        minimumSupportedRelease: params.minimumSupportedRelease,
        maximumSupportedRelease: params.maximumSupportedRelease,
    };
}
