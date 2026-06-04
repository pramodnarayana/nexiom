import { describe, it, expect, vi } from 'vitest';
import { LazyZodValidationPipe } from './lazy-zod-validation.pipe.js';
import { z } from 'zod';
import type { ArgumentMetadata } from '@nestjs/common';

// Mock nestjs-zod pipe so we don't need real decorators/modules
vi.mock('nestjs-zod', () => {
  return {
    ZodValidationPipe: class MockZodPipe {
      constructor(private schema: unknown) {}
      transform(value: unknown) {
        return String(value) + '-transformed';
      }
    },
  };
});

describe('LazyZodValidationPipe', () => {
  it('should skip transformation for custom decorators (not body, query, param)', () => {
    const pipe = new LazyZodValidationPipe(() => z.string());
    const result = pipe.transform('test', {
      type: 'custom',
    } as ArgumentMetadata);
    expect(result).toBe('test');
  });

  it('should transform using ZodValidationPipe for body, query, param', () => {
    const pipe = new LazyZodValidationPipe(() => z.string());

    expect(pipe.transform('val1', { type: 'body' } as ArgumentMetadata)).toBe(
      'val1-transformed',
    );
    expect(pipe.transform('val2', { type: 'query' } as ArgumentMetadata)).toBe(
      'val2-transformed',
    );
    expect(pipe.transform('val3', { type: 'param' } as ArgumentMetadata)).toBe(
      'val3-transformed',
    );
  });
});
