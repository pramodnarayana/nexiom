import { Request, Response } from 'express';
import { vi } from 'vitest';

export const toNodeHandler = vi.fn(
  () => (_req: Request, res: Response) => res.end(),
);

export const fromNodeHeaders = vi.fn(
  (headers: Record<string, string | string[] | undefined> | HeadersInit) =>
    new Headers(headers as unknown as HeadersInit),
);
