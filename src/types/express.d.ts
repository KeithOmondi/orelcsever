// src/types/express.d.ts
import { Role } from './roles';

// Augments Express's Request so `req.user` is typed everywhere
// after the auth middleware runs, without needing `as any` casts.
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Populated by refreshAccessToken middleware when a refresh token is used. */
      refreshToken?: string;
    }
  }
}

export {};