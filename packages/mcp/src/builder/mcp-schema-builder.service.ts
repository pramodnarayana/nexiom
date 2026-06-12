import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Action, PropertyType, AnyProperty } from '@soopa/piece-framework';

@Injectable()
export class McpSchemaBuilderService {
  /**
   * Converts Soopa Piece action properties into a Zod validation schema
   * required by the Vercel AI SDK.
   */
  public buildZodSchemaForProps(props: Record<string, AnyProperty>): z.ZodObject<any> {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(props)) {
      let schema: z.ZodTypeAny;

      // Cast to string to safely handle all PropertyType variants, including
      // those not present in the narrow AnyProperty union (ARRAY, OBJECT, etc.)
      switch (prop.type as string) {
        case PropertyType.SHORT_TEXT:
        case PropertyType.LONG_TEXT:
        case PropertyType.SECRET_TEXT:
          schema = z.string();
          break;
        case PropertyType.NUMBER:
          schema = z.number();
          break;
        case PropertyType.CHECKBOX:
          schema = z.boolean();
          break;
        case PropertyType.ARRAY:
          schema = z.array(z.any());
          break;
        case PropertyType.OBJECT:
        case PropertyType.JSON:
          schema = z.record(z.string(), z.any());
          break;
        case PropertyType.DROPDOWN:
        case PropertyType.STATIC_DROPDOWN:
        case PropertyType.MULTI_SELECT_DROPDOWN:
        case PropertyType.STATIC_MULTI_SELECT_DROPDOWN:
        case PropertyType.DYNAMIC:
        case PropertyType.FILE:
        case PropertyType.CUSTOM_AUTH:
        default:
          schema = z.any();
          break;
      }

      if (prop.description) {
        schema = schema.describe(prop.description);
      }

      shape[key] = prop.required ? schema : schema.optional();
    }

    return z.object(shape);
  }

  /**
   * Builds a named Zod parameter schema for a given Piece Action, ready to be
   * passed to the Vercel AI SDK `tool({ parameters })` call.
   */
  public buildToolSchema(
    pieceName: string,
    action: Action,
  ): { description: string; parameters: z.ZodObject<any> } {
    return {
      description: action.description || `Execute action: ${action.displayName} (${pieceName})`,
      parameters: this.buildZodSchemaForProps(action.props),
    };
  }
}
