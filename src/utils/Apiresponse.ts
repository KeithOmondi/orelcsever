import { Response } from 'express';

// Small helper so every endpoint replies in the same shape:
// { status: "success", message, data: {...} }
export const sendResponse = <T = null>(
  res: Response,
  statusCode: number,
  data: T = null as T,
  message?: string
): void => {
  res.status(statusCode).json({
    status: 'success',
    message,
    data,
  });
};