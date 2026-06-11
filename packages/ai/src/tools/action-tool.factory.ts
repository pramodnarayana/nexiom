import { Injectable, Logger } from '@nestjs/common';
import { dynamicTool } from 'ai';
import { z } from 'zod';
import { toAISchema } from './tool-zod.wrapper.js';
import { optimizePayloadTokens } from '../transformers/token-optimizer.util.js';
import type { Piece } from '@soopa/piece-framework';

@Injectable()
export class ActionToolFactory {
  private readonly logger = new Logger(ActionToolFactory.name);

  buildActionTools(
    tools: Record<string, any>,
    piece: Piece,
    conn: { id: string; appName: string },
    creds: Record<string, unknown>,
    traceId: string,
  ): void {
    for (const [actionName, action] of Object.entries(piece.actions || {})) {
      const toolName = `${conn.appName}_${conn.id}_${actionName}`.replace(
        /[^a-zA-Z0-9_-]/g,
        '_',
      );

      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, prop] of Object.entries(action.props || {})) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const propType = (prop as any).type as string;
        let s: z.ZodTypeAny;
        if (['SHORT_TEXT', 'LONG_TEXT', 'SECRET_TEXT'].includes(propType))
          s = z.string();
        else if (propType === 'NUMBER') s = z.number();
        else if (propType === 'CHECKBOX') s = z.boolean();
        else if (propType === 'ARRAY') s = z.array(z.any());
        else s = z.any();

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        let propDesc = (prop as any).description as string | undefined;
        if (propDesc) {
          if (propDesc.length > 50) propDesc = propDesc.substring(0, 50) + '...';
          s = s.describe(propDesc);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        shape[key] = (prop as any).required ? s : s.optional();
      }

      shape['confirmed'] = z
        .boolean()
        .optional()
        .describe('User confirmation required before executing this action');

      const actionExecutorInputSchema = z.object(shape);

      tools[toolName] = dynamicTool({
        description: [
          action.description || `Execute: ${action.displayName}`,
          `(via connection ${conn.id})`,
        ].join(' '),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: toAISchema(actionExecutorInputSchema),
        execute: async (input: unknown) => {
          const args = input as z.infer<typeof actionExecutorInputSchema>;
          this.logger.log(`[${traceId}] Executing action tool: ${toolName}`);

          const argsWithConfirm = args as Record<string, unknown> & {
            confirmed?: boolean;
          };
          if (argsWithConfirm.confirmed !== true) {
            return {
              success: false,
              error:
                'Action requires explicit user confirmation. Please set confirmed=true to proceed.',
              connectionName: `connection-${conn.id}`,
            };
          }

          const { confirmed: _confirmed, ...sanitizedArgs } = argsWithConfirm;

          try {
            const resultRaw = (await action.run({
              auth: creds,
              propsValue: sanitizedArgs,
            })) as unknown;

            // PER USER REQUEST: Withholding Action finalPayload
            // Skip optimization since we're not using the result
            return { stopped_for_token_safety: true };
          } catch (e: unknown) {
            this.logger.error(`[${traceId}] Action tool execution failed`, (e as Error).stack);
            return {
              success: false,
              error: `Action failed: ${(e as Error).message}`,
              connectionName: `connection-${conn.id}`,
            };
          }
        },
      });
    }
  }
}