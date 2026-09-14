import { Request, Response, NextFunction } from 'express';
import { Role } from '../types/roles';
import { AppError } from '../utils/Apperror';

// Restricts a route to one or more roles. Must run AFTER `authenticate`,
// since it reads req.user set by that middleware.
//
// Usage:
//   router.delete('/patients/:id', authenticate, restrictTo('admin'), ...)
//   router.get('/records/:id', authenticate, restrictTo('admin', 'super_admin'), ...)
export const restrictTo = (...allowedRoles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('You are not logged in. Please log in to get access.', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action.', 403));
    }

    next();
  };
};

// Convenience shorthands for the two roles you have today.
export const adminOnly = restrictTo('admin', 'super_admin');
export const superAdminOnly = restrictTo('super_admin');