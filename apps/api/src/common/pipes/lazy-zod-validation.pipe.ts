import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { ZodType } from 'zod';

@Injectable()
export class LazyZodValidationPipe implements PipeTransform {
  private pipe: PipeTransform | undefined;

  constructor(private readonly schemaFactory: () => ZodType) {}

  transform(value: any, metadata: ArgumentMetadata) {
    // Only validate request inputs (Body, Query, Param).
    // Custom decorators like @AuthContext() or @User() inject internal objects
    // that do NOT match the DTO schema and must be skipped to prevent validation errors.
    if (
      metadata.type !== 'body' &&
      metadata.type !== 'query' &&
      metadata.type !== 'param'
    ) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return value;
    }
    this.pipe ??= new ZodValidationPipe(this.schemaFactory());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return this.pipe.transform(value, metadata);
  }
}
