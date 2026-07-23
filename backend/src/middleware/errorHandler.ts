import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      details: err.details,
    });
    return;
  }

  console.error('[API]', err);
  res.status(500).json({
    error: err instanceof Error ? err.message : 'Internal server error',
  });
}
