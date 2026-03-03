import { AnyProperty } from './property.js';

export interface ActionContext<AuthT, PropsT> {
    auth: AuthT;
    propsValue: PropsT;
}

export interface Action<AuthT = any, PropsT = any, ReturnT = any> {
    name: string;
    displayName: string;
    description: string;
    props: Record<string, AnyProperty>;
    requireAuth: boolean;
    run: (context: ActionContext<AuthT, PropsT>) => Promise<ReturnT>;
}

export interface CreateActionParams<AuthT, PropsT, ReturnT> {
    name: string;
    displayName: string;
    description: string;
    props: Record<string, AnyProperty>;
    requireAuth: boolean;
    run: (context: ActionContext<AuthT, PropsT>) => Promise<ReturnT>;
}

/**
 * Mocks the exact Activepieces createAction function.
 * Wraps the execution logic and property definitions so they can be securely orchestrated by the Host Engine.
 */
export function createAction<AuthT = any, PropsT = any, ReturnT = any>(
    params: CreateActionParams<AuthT, PropsT, ReturnT>,
): Action<AuthT, PropsT, ReturnT> {
    return {
        ...params,
    };
}

export interface CustomApiCallParams {
    baseUrl: (auth: unknown) => string;
    auth: unknown;
    authMapping: (auth: unknown) => Promise<Record<string, string>>;
}

/**
 * Stub for the Activepieces createCustomApiCallAction used by pieces-common.
 * Returns a no-op action so external pieces that register a custom API call
 * action can be loaded without errors.
 */
export function createCustomApiCallAction(_params: CustomApiCallParams): Action {
    return createAction({
        name: 'custom_api_call',
        displayName: 'Custom API Call',
        description: 'Performs a custom API call.',
        requireAuth: true,
        props: {},
        run: async () => { throw new Error('Not implemented'); },
    });
}
