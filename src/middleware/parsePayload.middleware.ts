// src/middleware/parsePayload.middleware.ts
//
// Multipart payload parser.
//
// When a request is multipart/form-data, multer flattens all non-file
// fields to strings. Our write routes ship a `payload` field that is
// a JSON-encoded object, so `req.body.payload` arrives as a string.
//
// This middleware parses it in place, before `validate` runs, so
// schemas that declare `{ payload: z.object(...) }` see an object.
//
// No-op for requests that don't have a string `payload` field. Safe
// to mount on any route.

import type { RequestHandler } from 'express';
import { AppError } from '../utils/Apperror';

export const parseMultipartPayload: RequestHandler = (req, _res, next) => {
  const body = req.body as Record<string, unknown> | undefined;

  if (!body || typeof body.payload !== 'string') {
    return next();
  }

  try {
    body.payload = JSON.parse(body.payload);
  } catch {
    return next(new AppError('payload must be valid JSON.', 400));
  }

  next();
};