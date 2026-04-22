export type AppWebhookResponseFn = (body: unknown, headers: Record<string, string>) => { body: string; contentType: string; status: number } | null;

const appResponseRegistry: AppWebhookResponseFn[] = [];

/**
 * Registers an interceptor that can evaluate raw L1 payloads to determine if a
 * synchronous app-specific response needs to be returned (e.g., Salesforce SOAP Ack).
 */
export function registerAppWebhookResponse(fn: AppWebhookResponseFn) {
    appResponseRegistry.push(fn);
}

/**
 * Executes all registered app webhook response handlers and returns the first match.
 */
export function executeAppWebhookResponses(body: unknown, headers: Record<string, string>): { body: string; contentType: string; status: number } | null {
    for (const fn of appResponseRegistry) {
        const result = fn(body, headers);
        if (result) return result;
    }
    return null;
}
