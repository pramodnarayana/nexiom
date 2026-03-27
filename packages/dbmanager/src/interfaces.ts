export enum SchemaPlan {
    /**
     * Only the empty PostgreSQL schema namespace (e.g., "ws_abc123")
     * Provisioned automatically when a connection handshake succeeds.
     */
    NAMESPACE_ONLY = 'NAMESPACE_ONLY',

    /**
     * The L1 Gateway tables (inbound_gateway).
     * Provisioned when a Route/Webhook is activated.
     * Note: sync_log is provisioned by provisionOutboundTables() (OUTBOUND_ACTIVE).
     */
    GATEWAY_ACTIVE = 'GATEWAY_ACTIVE',

    /**
     * The L2 Unified Replica tables (replica_entity, sync_cursor)
     * Provisioned when an object mapping is initialized.
     */
    REPLICA_ACTIVE = 'REPLICA_ACTIVE',

    /**
     * The L3 Normalization tables (normalized_entity)
     * Provisioned when normalization is activated for a connection.
     */
    NORMALIZE_ACTIVE = 'NORMALIZE_ACTIVE',

    /**
     * The L5/L6 Outbound tables (outbound_gateway, sync_log)
     * Provisioned when delivery is activated for a connection.
     */
    OUTBOUND_ACTIVE = 'OUTBOUND_ACTIVE',
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
