import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/Apperror';

// Mount this LAST in app.ts, after routes and after notFound.
// Express recognizes it as an error handler because it takes 4 args.
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const status = isAppError ? err.status : 'error';

  // Operational errors (AppError, e.g. thrown by auth/role middleware) are
  // safe to show the client verbatim. Anything else is a bug — log it.
  if (!isAppError) {
    console.error('Unhandled Error:', err);
  }

  res.status(statusCode).json({
    status,
    message: err.message || 'Internal Server Error',
  });
};