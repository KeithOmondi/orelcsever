// middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, verifyRefreshToken, TokenPayload } from '../utils/jwt';
import { AppError } from '../utils/Apperror';
import { Role, ROLES } from '../types/roles';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      // For refresh token endpoint
      refreshToken?: string;
    }
  }
}

// Re-export for backward compatibility
export type UserRole = Role;

const ADMIN_ROLES: readonly Role[] = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

// ============================================================
// OPTIONAL AUTH — sets req.user if valid, continues if not
// ============================================================
export const optionalAuth = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = verifyAccessToken(token);
  } catch {
    // silently continue for optional auth
  }

  next();
};

// ============================================================
// PROTECT — requires a valid access token
// ============================================================
export const protect = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new AppError('You are not logged in. Please log in to get access.', 401)
    );
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (err) {
    if (err instanceof Error && err.name === 'TokenExpiredError') {
      return next(
        new AppError('Token expired. Please refresh your token.', 401)
      );
    }
    next(new AppError('Invalid token. Please log in again.', 401));
  }
};

// ============================================================
// PROTECT WITH REFRESH — accepts either access or refresh token
// ============================================================
export const protectWithRefresh = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new AppError('You are not logged in. Please log in to get access.', 401)
    );
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch {
    try {
      req.user = verifyRefreshToken(token);
      req.refreshToken = token;
      return next();
    } catch {
      return next(new AppError('Invalid token. Please log in again.', 401));
    }
  }
};

// ============================================================
// ROLE-BASED AUTHORIZATION
// ============================================================
export const requireRole = (...allowedRoles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('You are not logged in.', 401));
    }

    if (!allowedRoles.includes(req.user.role as Role)) {
      return next(
        new AppError(
          `Access denied. Required role: ${allowedRoles.join(' or ')}`,
          403
        )
      );
    }

    next();
  };
};

// Convenience guards
/** Any authenticated admin (admin OR super_admin). */
export const adminOnly = requireRole(...ADMIN_ROLES);

/** Only super_admin. */
export const superAdminOnly = requireRole(ROLES.SUPER_ADMIN);

/** Explicitly both — useful for clarity at call sites. */
export const adminOrSuperAdmin = requireRole(...ADMIN_ROLES);

// ============================================================
// OWNER-OR-ADMIN
// ============================================================
export const isOwnerOrAdmin = (
  getResourceUserId: (req: Request) => string
) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('You are not logged in.', 401));
    }

    // Both admin and super_admin get full access
    if (ADMIN_ROLES.includes(req.user.role as Role)) {
      return next();
    }

    const resourceUserId = getResourceUserId(req);
    if (req.user.id !== resourceUserId) {
      return next(
        new AppError('You do not have permission to access this resource.', 403)
      );
    }

    next();
  };
};

// ============================================================
// REFRESH TOKEN MIDDLEWARE (used on /auth/refresh)
// ============================================================
export const refreshAccessToken = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  // Prefer the httpOnly cookie, fall back to body for non-browser clients.
  const token =
    req.cookies?.refreshToken ??
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.split(' ')[1]
      : undefined) ??
    req.body?.refreshToken;

  if (!token) {
    return next(new AppError('Refresh token required.', 401));
  }

  try {
    req.user = verifyRefreshToken(token);
    req.refreshToken = token;
    next();
  } catch (err) {
    if (err instanceof Error && err.name === 'TokenExpiredError') {
      return next(
        new AppError('Refresh token expired. Please log in again.', 401)
      );
    }
    next(new AppError('Invalid refresh token.', 401));
  }
};