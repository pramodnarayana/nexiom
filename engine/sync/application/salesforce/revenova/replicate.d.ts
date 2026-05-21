/**
 * Extracts the core entity from a Revenova (Salesforce) Outbound Message SOAP XML payload.
 */
export declare function ReplicateRevenovaObject(payload: unknown): Promise<{
    entityType: string;
    entityId: string;
    data: Record<string, unknown>;
} | null>;
