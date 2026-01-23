import { Request, Response } from 'express';

export const toNodeHandler = jest.fn(
  () => (_req: Request, res: Response) => res.end(),
);

export const fromNodeHeaders = jest.fn(
  (headers: Record<string, string | string[] | undefined> | HeadersInit) =>
    new Headers(headers as any),
);
