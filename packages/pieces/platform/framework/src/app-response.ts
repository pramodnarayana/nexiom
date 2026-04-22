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
 * Resets the app response registry. Used for testing to avoid cross-test state leakage.
 */
export function resetAppResponseRegistry() {
    appResponseRegistry.length = 0;
}

/**
 * Executes all registered app webhook response handlers and returns the first match.
 * Wraps each handler in try/catch to prevent a single failing handler from breaking
 * the entire chain. Logs errors and continues to the next handler.
 */
export function executeAppWebhookResponses(body: unknown, headers: Record<string, string>): { body: string; contentType: string; status: number } | null {
    for (let i = 0; i < appResponseRegistry.length; i++) {
        const fn = appResponseRegistry[i];
        try {
            const result = fn(body, headers);
            if (result) return result;
        } catch (error) {
            console.error(
                `[executeAppWebhookResponses] Handler ${i} threw an error:`,
                error instanceof Error ? error.message : String(error),
                error
            );
            // Continue to next handler instead of bubbling up
        }
    }
    return null;
}