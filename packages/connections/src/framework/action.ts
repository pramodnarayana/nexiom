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
