/** Injection token — use to inject the active IEncryptionService implementation. */
export const ENCRYPTION_SERVICE = "ENCRYPTION_SERVICE" as const;

/** Internal token — carries module options to the adapter factory via DI. */
export const ENCRYPTION_MODULE_OPTIONS = "ENCRYPTION_MODULE_OPTIONS" as const;
