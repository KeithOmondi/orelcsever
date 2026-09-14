import { Request, Response, NextFunction, RequestHandler } from "express";

// Wrap any async route handler with this so a rejected promise
// is forwarded to next(err) instead of crashing the process.
//
// Usage: router.get("/patients", catchAsync(async (req, res) => { ... }))
export const catchAsync = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};