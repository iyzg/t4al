import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Wraps async route handlers so rejected promises are passed to Express error middleware.
// Express 5 does NOT do this automatically for route handlers.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
