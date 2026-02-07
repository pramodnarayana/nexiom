import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { ZodSchema } from 'zod';

@Injectable()
export class LazyZodValidationPipe implements PipeTransform {
  constructor(private readonly schemaFactory: () => ZodSchema) {}

  transform(value: any, metadata: ArgumentMetadata) {
    const schema = this.schemaFactory();
    const pipe = new ZodValidationPipe(schema);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return pipe.transform(value, metadata);
  }
}
