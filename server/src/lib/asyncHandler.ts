import { Request, Response, NextFunction, RequestHandler } from "express";

/** Wraps an async route handler so rejected promises reach the error middleware
 *  instead of crashing the process (Express 4 doesn't do this automatically). */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
