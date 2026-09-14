// middleware/validateQuery.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      validatedQuery?: any;
    }
  }
}

export const validateQuery = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate req.query directly
      const validated = schema.parse(req.query);
      // Store validated data on req.customQuery instead
      req.validatedQuery = validated;
      next();
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          status: 400,
          message: 'Validation failed',
          errors: error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      if (error instanceof Error) {
        return res.status(400).json({
          status: 400,
          message: error.message || 'Invalid query parameters',
        });
      }
      return res.status(400).json({
        status: 400,
        message: 'Invalid query parameters',
      });
    }
  };
};