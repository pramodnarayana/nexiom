import { Injectable, Logger } from '@nestjs/common';
import { generateObject, convertToModelMessages, type UIMessage } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

@Injectable()
export class IntentClassifierService {
  private readonly logger = new Logger(IntentClassifierService.name);

  /**
   * Deterministically identifies which specific App Connections the user needs.
   * If the user asks a question entirely unrelated to any connected app (e.g., "What is the capital of France?"),
   * this will return an empty array, prompting the Orchestrator to reject the interaction.
   */
  async classifyIntent(
    messages: UIMessage[],
    activeConnections: { id: string; appName: string; displayName: string | null }[],
    traceId: string,
  ): Promise<{ targetedConnectionIds: string[] }> {
    if (activeConnections.length === 0) {
      return { targetedConnectionIds: [] };
    }

    const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
    if (!lastUserMessage) {
      // If no explicit user interaction is found, default to allowing all to maintain context
      return { targetedConnectionIds: activeConnections.map((c) => c.id) };
    }

    this.logger.log(`[${traceId}] Executing Fast-Path Intent Classification for connections...`);

    const connectedAppsList = activeConnections
      .map((c) => `- ConnectionID: "${c.id}" (App: ${c.appName}, Display: ${c.displayName || 'Default'})`)
      .join('\n');

    try {
      const modelMessages = await convertToModelMessages(messages.slice(-3));
      
      const classificationSchema: any = z.object({
        targetedConnectionIds: z
          .array(z.string())
          .describe(
            'A list of ConnectionIDs that the user explicitly needs to answer their query. Must strictly be selected from the provided list. If the request is generic chit-chat or completely unrelated to these domain apps, return an empty array [] to reject the request.',
          ),
      });

      const result = await generateObject({
        model: google('gemini-1.5-flash'),
        schema: classificationSchema,
        system: `You are a strict Enterprise JIT (Just-In-Time) Connection Router.
Your objective is to identify which SaaS connections are strictly necessary to answer the user's query.

AVAILABLE CONNECTIONS:
${connectedAppsList}

RULES:
1. If the user asks about a CRM, Logistics, or Load record but does not specify the app, intuitively map it to the closest match (e.g. loads = salesforce or a TMS).
2. If the user engages in off-topic chat (e.g., "write me a poem", "hello"), you MUST return an empty array []. We do not support fallback generic queries.
3. You must ONLY return ConnectionIDs exactly as they appear in the AVAILABLE CONNECTIONS list.`,
        messages: modelMessages,
      });

      const parsedObject = result.object as { targetedConnectionIds: string[] };
      this.logger.debug(`[${traceId}] Intent routed to connections: ${JSON.stringify(parsedObject.targetedConnectionIds)}`);
      return parsedObject;
    } catch (e: unknown) {
      this.logger.warn(`[${traceId}] Intent classifier failed, falling back to all active connections. Error: ${(e as Error).message}`);
      // Fallback: If the fast-path fails to generate the JSON graph due to a provider timeout, default to passing all tools so the user isn't fully blocked.
      return { targetedConnectionIds: activeConnections.map((c) => c.id) };
    }
  }
}
