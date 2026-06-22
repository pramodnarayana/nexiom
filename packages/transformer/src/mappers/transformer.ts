import { TransformerPort, TransformationContext } from '../core/transformer.port.js';
import { TransformerException } from '../errors/transformer.exception.js';

export interface MappingConfig {
  [canonicalKey: string]: unknown;
}

/**
 * A highly performant Transformer that executes declarative mapping configurations
 * against arbitrary raw SaaS data payloads.
 */
export class Transformer implements TransformerPort<Record<string, unknown>, Record<string, unknown>> {
  constructor(private readonly mappingConfig: MappingConfig) {}

  /**
   * Transforms a raw JS object using the defined JSON mapping configuration.
   *
   * @param rawData The raw JSON object from the external source
   * @param context Transformation context for logging, tracing, etc.
   */
  public transform(rawData: Record<string, unknown>, context?: TransformationContext): Record<string, unknown> {
    if (!rawData || !this.mappingConfig) {
      throw new TransformerException('Both rawData and mappingConfig are required');
    }

    const output: Record<string, unknown> = {};

    for (const [canonicalKey, instruction] of Object.entries(this.mappingConfig)) {
      try {
        if (typeof instruction === 'string') {
          // Simple dot-notation path extraction
          output[canonicalKey] = this.resolvePath(rawData, instruction);
        } else if (typeof instruction === 'object' && instruction !== null) {
          // Nested structures or arrays
          output[canonicalKey] = this.processComplexInstruction(rawData, instruction as Record<string, unknown>, context);
        }
      } catch (err: unknown) {
        context?.logger?.warn(`Failed to map key '${canonicalKey}': ${(err as Error).message}`);
        output[canonicalKey] = null;
      }
    }

    return output;
  }

  /**
   * Safely resolves a dot.notation string path against an object containing data.
   */
  private resolvePath(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((acc: unknown, part) => {
      if (acc && typeof acc === 'object' && part in acc) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, obj);
  }

  /**
   * Handles arrays, conditionals, and nested recursive mappings.
   */
  private processComplexInstruction(
    rawData: Record<string, unknown>, 
    instruction: Record<string, unknown>,
    context?: TransformationContext
  ): unknown {
    // Handling Arrays / Collections (e.g. Stops, Line Items)
    if (instruction.type === 'array' && typeof instruction.source === 'string' && instruction.mapping) {
      const sourceArray = this.resolvePath(rawData, instruction.source);
      if (!Array.isArray(sourceArray)) {
        return [];
      }
      
      const subTransformer = new Transformer(instruction.mapping as MappingConfig);
      return sourceArray.map((item) => subTransformer.transform(item as Record<string, unknown>, context));
    }

    // Extensibility: Conditional or computed transforms would be hooked here
    if (instruction.compute) {
      context?.logger?.debug(`Compute instruction bypassed for safe evaluation: ${instruction.compute}`);
      return null;
    }

    // Nested object recursion
    if (!instruction.source && !instruction.type) {
      const subTransformer = new Transformer(instruction as MappingConfig);
      return subTransformer.transform(rawData, context);
    }

    // Default raw path extraction if "source" property exists explicitly
    if (typeof instruction.source === 'string' && !instruction.type) {
      const rawVal = this.resolvePath(rawData, instruction.source);
      
      // Optional mapping dictionary to translate string constants directly
      if (instruction.transform && typeof instruction.transform === 'object' && rawVal !== undefined) {
        const key = String(rawVal);
        const transformMap = instruction.transform as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(transformMap, key)) {
          return transformMap[key];
        }
      }
      return rawVal;
    }

    return null;
  }
}
