import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { ZodSchema } from 'zod';

@Injectable()
export class LazyZodValidationPipe implements PipeTransform {
  private schema: ZodSchema | undefined;

  private pipe: any;

  constructor(private readonly schemaFactory: () => ZodSchema) {}

  transform(value: any, metadata: ArgumentMetadata) {
    if (!this.schema) {
      this.schema = this.schemaFactory();
      this.pipe = new ZodValidationPipe(this.schema);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return this.pipe.transform(value, metadata);
  }
}
