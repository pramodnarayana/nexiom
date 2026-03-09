import { Action } from './action.js';
import { PieceAuthProperty } from './auth.js';
import { Trigger } from './trigger.js';
import { InternalServerErrorException } from '@nestjs/common';

export interface Piece {
    name: string;
    displayName: string;
    logoUrl: string;
    description: string;
    /** Auth definition — required for any registered piece. */
    auth: PieceAuthProperty;
    /** Piece categories (e.g. ['SALES_AND_CRM']). */
    categories: string[];
    actions: Record<string, Action>;
    triggers: Record<string, Trigger>;
    minimumSupportedRelease?: string;
    maximumSupportedRelease?: string;
}

export enum PieceCategory {
    ARTIFICIAL_INTELLIGENCE = 'Artificial Intelligence',
    BUSINESS_INTELLIGENCE = 'Business Intelligence',
    COMMUNICATION = 'Communication',
    CORE = 'Core',
    DEVELOPER_TOOLS = 'Developer Tools',
    HUMAN_RESOURCES = 'Human Resources',
    MARKETING = 'Marketing',
    PRODUCTIVITY = 'Productivity',
    SALES_AND_CRM = 'Sales & CRM',
    ACCOUNTING = 'Accounting',
    FINANCE = 'Finance',
    OTHER = 'Other'
}

export interface CreatePieceParams {
    name?: string;
    displayName: string;
    logoUrl: string;
    authors?: string[];
    categories?: any[];
    auth?: PieceAuthProperty;
    actions: Action[];
    triggers: Trigger[];
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
        (acc, trigger: Trigger) => {
            // Guard: skip entries that are not valid objects with a non-empty name
            if (
                typeof trigger !== 'object' ||
                trigger === null ||
                typeof trigger.name !== 'string' ||
                trigger.name.length === 0
            ) {
                console.warn('[createPiece] Skipping invalid trigger entry — missing or non-string name:', trigger);
                return acc;
            }
            if (acc[trigger.name]) {
                throw new InternalServerErrorException(`Duplicate trigger name: ${trigger.name}`);
            }
            acc[trigger.name] = trigger;
            return acc;
        },
        {} as Record<string, Trigger>,
    );

    return {
        name: params.name || '',
        displayName: params.displayName,
        logoUrl: params.logoUrl,
        description: params.description || '',
        auth: params.auth!,
        categories: (params.categories ?? []).map(String),
        actions: actionsMap,
        triggers: triggersMap,
        minimumSupportedRelease: params.minimumSupportedRelease,
        maximumSupportedRelease: params.maximumSupportedRelease,
    };
}
