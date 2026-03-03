export enum SchemaPlan {
    /**
     * Only the empty PostgreSQL schema namespace (e.g., "ws_abc123")
     * Provisioned automatically when a connection handshake succeeds.
     */
    NAMESPACE_ONLY = 'NAMESPACE_ONLY',

    /**
     * The L1 Gateway tables (inbound_gateway, sync_logs)
     * Provisioned when a Route/Webhook is activated.
     */
    GATEWAY_ACTIVE = 'GATEWAY_ACTIVE',

    /**
     * The L2 Unified Replica tables (replica_entity)
     * Provisioned when an object mapping is initialized.
     */
    REPLICA_ACTIVE = 'REPLICA_ACTIVE',
}

/**
 * Enterprise declarative database manager interface.
 * Implements the Hexagonal Architecture "Port" pattern to decouple
 * physical schema provisioning from API business logic.
 */
export interface DatabaseManager {
    /**
     * Idempotently bring the schema up to the desired plan level.
     * If the schema already exceeds the plan, it does nothing.
     */
    applyPlan(schemaName: string, plan: SchemaPlan): Promise<void>;
}
