import { Injectable, Logger } from '@nestjs/common';

/**
 * A highly performant Transformation Engine that executes JSON mapping configurations
 * against arbitrary raw SaaS data payloads.
 */
@Injectable()
export class TransformationEngine {
  private readonly logger = new Logger(TransformationEngine.name);

  /**
   * Transforms a raw JS object using a defined JSON mapping configuration.
   *
   * @param rawData The raw JSON object from the external source
   * @param mappingConfig The object-to-object field mapping (e.g., {"number": "rtms__Load__c.Name"})
   */
  public transform(rawData: any, mappingConfig: Record<string, any>): any {
    if (!rawData || !mappingConfig) return null;

    const output: Record<string, any> = {};

    for (const [canonicalKey, instruction] of Object.entries(mappingConfig)) {
      try {
        if (typeof instruction === 'string') {
          // Simple dot-notation path extraction
          output[canonicalKey] = this.resolvePath(rawData, instruction);
        } else if (typeof instruction === 'object' && instruction !== null) {
          // Nested structures or arrays
          output[canonicalKey] = this.processComplexInstruction(rawData, instruction);
        }
      } catch (err: unknown) {
        this.logger.warn(`Failed to map key '${canonicalKey}': ${(err as Error).message}`);
        output[canonicalKey] = null;
      }
    }

    return output;
  }

  /**
   * Safely resolves a dot.notation string path against an object containing data.
   */
  private resolvePath(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
  }

  /**
   * Handles arrays, conditionals, and nested recursive mappings.
   */
  private processComplexInstruction(rawData: any, instruction: Record<string, any>): any {
    // Handling Arrays / Collections (e.g. Stops, Line Items)
    if (instruction.type === 'array' && instruction.source && instruction.mapping) {
      const sourceArray = this.resolvePath(rawData, instruction.source);
      if (!Array.isArray(sourceArray)) {
        return [];
      }
      return sourceArray.map(item => this.transform(item, instruction.mapping));
    }

    // Extensibility: Conditional or computed transforms would be hooked here
    if (instruction.compute) {
      // Mock compute behavior (in production, use a safe AST parser rather than eval)
      this.logger.debug(`Compute instruction bypassed for safe evaluation: ${instruction.compute}`);
      return null;
    }

    // Nested object recursion
    // If it's just a nested mapping block (that doesn't have reserved instruction keywords like 'type'/'source')
    if (!instruction.source && !instruction.type) {
      return this.transform(rawData, instruction);
    }

    // Default raw path extraction if "source" property exists explicitly
    if (instruction.source && !instruction.type) {
      const rawVal = this.resolvePath(rawData, instruction.source);
      // Optional mapping dictionary to translate string constants directly
      if (instruction.transform && rawVal !== undefined) {
         return instruction.transform[String(rawVal)] || rawVal;
      }
      return rawVal;
    }

    return null;
  }
}
