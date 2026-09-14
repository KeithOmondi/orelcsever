import { Request, Response } from 'express';

// Mount this AFTER all your routes in app.ts so unmatched paths
// get a clean 404 instead of Express's default HTML error page.
export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({
    status: 'fail',
    message: `Can't find ${req.originalUrl} on this server!`,
  });
};