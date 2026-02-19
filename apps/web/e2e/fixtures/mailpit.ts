import { type APIRequestContext } from '@playwright/test';

export interface EmailMessage {
    ID: string;
    MessageID: string;
    Subject: string;
    To: { Name: string; Address: string }[];
    From: { Name: string; Address: string }[];
    Text: string;
    HTML: string;
    Date: string;
}

export class MailpitFixture {
    private readonly apiContext: APIRequestContext;
    private readonly baseUrl: string;

    constructor(apiContext: APIRequestContext) {
        this.apiContext = apiContext;
        // Mailpit UI/API port is 8025
        const rawUrl = process.env.MAILPIT_URL || process.env.MAILPIT_BASE_URL || 'http://localhost:8025';
        // Ensure no trailing slash, then append /api/v1
        this.baseUrl = `${rawUrl.replace(/\/$/, '')}/api/v1`;
    }

    /**
     * Waits for the latest email for a specific recipient.
     * Polls the Mailpit API until an email is found or timeout is reached.
     */
    async waitForEmail(recipient: string, subject?: string, timeout = 30000): Promise<EmailMessage> {
        const startTime = Date.now();
        console.log(`[Mailpit] Waiting for email to ${recipient} (timeout: ${timeout}ms)...`);

        while (Date.now() - startTime < timeout) {
            try {
                // Search for messages to this recipient
                const response = await this.apiContext.get(`${this.baseUrl}/messages`, {
                    params: {
                        query: `to:${recipient}`,
                        limit: 50,
                    },
                });

                if (!response.ok()) {
                    console.warn(`[Mailpit] API error: ${response.status()} ${response.statusText()}`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;
                }

                const data = await response.json();
                const messages = data.messages || [];

                for (const msgSummary of messages) {
                    // Check recipient in summary first (optimization)
                    // Mailpit summary To is Array of {Name, Address}
                    const recipientMatch = msgSummary.To.some((t: { Name: string; Address: string }) => t.Address === recipient);

                    if (!recipientMatch) {
                        continue;
                    }

                    // Check subject in summary if matched
                    if (subject && !msgSummary.Subject.includes(subject)) {
                        continue;
                    }

                    const msgResponse = await this.apiContext.get(`${this.baseUrl}/message/${msgSummary.ID}`);
                    if (!msgResponse.ok()) {
                        console.warn(`[Mailpit] Failed to fetch message ${msgSummary.ID}: ${msgResponse.status()}`);
                        continue;
                    }
                    const fullMessage = await msgResponse.json() as EmailMessage;
                    console.log(`[Mailpit] Email found: "${fullMessage.Subject}"`);
                    return fullMessage;
                }

                // If loop finishes without returning, no match found in this batch.
            } catch (error) {
                console.error('[Mailpit] Error querying API:', error);
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        throw new Error(`[Mailpit] Timeout waiting for email to ${recipient} with subject "${subject || '*'}"`);
    }

    /**
     * Extracts a link from the email body matching the provided regex.
     */
    extractLink(email: EmailMessage, pattern: RegExp): string {
        // Try HTML first, then fall back to Text
        for (const body of [email.HTML, email.Text]) {
            if (!body) continue;
            const match = body.match(pattern);
            if (match?.[1]) {
                const url = match[1].replaceAll('&amp;', '&');
                console.log(`[Mailpit] Extracted link: ${url}`);
                return url;
            }
        }

        throw new Error(`[Mailpit] Could not find link matching pattern in email body.`);
    }

    /**
     * Deletes all messages in Mailpit (Global Cleanup)
     */
    async deleteAllMessages(): Promise<void> {
        try {
            await this.apiContext.delete(`${this.baseUrl}/messages`);
            console.log('[Mailpit] Deleted all messages');
        } catch (error) {
            console.error('[Mailpit] Failed to delete messages:', error);
        }
    }
}
