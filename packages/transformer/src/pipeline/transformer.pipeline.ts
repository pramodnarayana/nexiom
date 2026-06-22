import { TransformerPort, TransformationContext } from '../core/transformer.port.js';

/**
 * A composite orchestrator that chains multiple transformers together.
 * Output of step N becomes the input of step N+1.
 */
export class TransformerPipeline<TIn, TOut> implements TransformerPort<TIn, TOut> {
  private constructor(
    private readonly steps: TransformerPort<unknown, unknown>[],
  ) {}

  /**
   * Initializes a new empty pipeline.
   * Useful when you want to start building a chain dynamically.
   */
  static create<T>(): TransformerPipeline<T, T> {
    return new TransformerPipeline<T, T>([]);
  }

  /**
   * Appends a new transformer step to the pipeline.
   * Type inference ensures the new step's input matches the current pipeline's output.
   */
  pipe<TNext>(step: TransformerPort<TOut, TNext>): TransformerPipeline<TIn, TNext> {
    return new TransformerPipeline<TIn, TNext>([...this.steps, step as unknown as TransformerPort<unknown, unknown>]);
  }

  /**
   * Executes all transformers in sequence.
   */
  async transform(input: TIn, context?: TransformationContext): Promise<TOut> {
    let current: unknown = input;

    for (const step of this.steps) {
      current = await step.transform(current, context);
    }

    return current as TOut;
  }
}
