import { AnyProperty } from './property.js';

/**
 * Mirrors the Activepieces TriggerStrategy enum.
 * POLLING — the engine calls run() on a cron schedule.
 * WEBHOOK — the api-gateway calls run() when a push event arrives.
 */
export enum TriggerStrategy {
    POLLING = 'POLLING',
    WEBHOOK = 'WEBHOOK',
}

export const DedupeStrategy = { TIMEBASED: 'TIMEBASED', LAST_ITEM: 'LAST_ITEM' };

export const pollingHelper = {
    onEnable: async () => { },
    onDisable: async () => { },
    test: async () => [],
    poll: async () => []
};

/**
 * Cursor-backed key/value store injected into every trigger context.
 * The host provides a Redis-backed implementation; pieces use it to track
 * the last-seen timestamp or ID so they never fetch the same data twice.
 */
export interface TriggerStore {
    get<T>(key: string): Promise<T | null>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
}

/**
 * Context object passed to every trigger lifecycle method.
 * - auth        — resolved credentials for the connection (OAuth token, API key, etc.)
 * - propsValue  — user-configured props (e.g., the selected Salesforce object type)
 * - store       — cursor store for tracking "last seen" state across runs
 * - payload     — raw inbound webhook body; undefined for polling triggers
 * - metadata    — runtime metadata stamped by the host (workspaceId, triggerName, appName)
 */
export interface TriggerContext<AuthT = any, PropsT = any> {
    auth: AuthT;
    propsValue: PropsT;
    store: TriggerStore;
    payload?: unknown;
    metadata: {
        workspaceId: string;
        triggerName: string;
        appName: string;
        objectType?: string;
        /** app_connection.id — populated for polling triggers so OptimizationService
         *  can load per-connection hints from the DB profile cache. */
        connectionId?: string;
    };
}

/**
 * A fully typed Activepieces-compatible Trigger definition.
 *
 * Lifecycle hooks (onEnable / onDisable) are optional — only webhook triggers
 * typically implement them to register/deregister subscriptions in the source app.
 *
 * verifySignature is called by the WebhooksController before run() for push triggers.
 * Throw any error to reject the request with 401 Unauthorized.
 */
export interface Trigger<AuthT = any, PropsT = any> {
    name: string;
    auth?: any;
    displayName: string;
    description: string;
    type: string | TriggerStrategy;
    props: Record<string, AnyProperty>;
    sampleData?: any;

    /**
     * Core execution: returns an array of inbound records.
     * For polling: all new records since the cursor.
     * For webhooks: the normalised event payload as a single-element or multi-element array.
     */
    run(context: TriggerContext<AuthT, PropsT>): Promise<unknown[]>;

    /** Called when the user activates a Route — use to register webhooks in the source app. */
    onEnable?(context: TriggerContext<AuthT, PropsT>): Promise<void>;

    /** Called when the Route is deactivated or deleted — prevents ghost webhooks. */
    onDisable?(context: TriggerContext<AuthT, PropsT>): Promise<void>;

    /**
     * Webhook-only. Called before run() to validate the request signature.
     * Throw any error to abort processing with 401 Unauthorized.
     */
    verifySignature?(
        headers: Record<string, string>,
        rawBody: Buffer,
        secret: string,
    ): void;
}

/**
 * Parameters accepted by createTrigger().
 *
 * Exactly mirrors the Trigger interface so there is a single source of truth.
 * Aliasing instead of extending/repeating prevents the two shapes from drifting.
 */
export type CreateTriggerParams<AuthT = any, PropsT = any> = Trigger<AuthT, PropsT>;

/**
 * Mocks the exact Activepieces createTrigger function.
 * Wraps the trigger definition so it can be hosted by the Soopa engine.
 */
export function createTrigger<AuthT = any, PropsT = any>(
    params: CreateTriggerParams<AuthT, PropsT>,
): Trigger<AuthT, PropsT> {
    return { ...params };
}
