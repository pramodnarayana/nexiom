import { Request, Response } from 'express';

export const toNodeHandler = jest.fn(
  () => (_req: Request, res: Response) => res.end(),
);

// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
export const fromNodeHeaders = jest.fn((headers: any) => new Headers(headers));
