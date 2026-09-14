import jwt, { SignOptions } from "jsonwebtoken";
import { Role } from "../types/roles";
import { env } from "../config/env";

// Secrets and expirations come from the validated env config —
// no duplicate parsing/fallback logic here, single source of truth.
const ACCESS_TOKEN_SECRET = env.ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = env.REFRESH_TOKEN_SECRET;
const ACCESS_TOKEN_EXPIRES_IN = env.ACCESS_TOKEN_EXPIRES_IN;
const REFRESH_TOKEN_EXPIRES_IN = env.REFRESH_TOKEN_EXPIRES_IN;

export interface TokenPayload {
  id: string;
  email: string;
  role: Role;
}

/**
 * Sign a short-lived Access Token (e.g., 15 minutes)
 */
export const signAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  } as SignOptions);
};

/**
 * Sign a long-lived Refresh Token (e.g., 7 days)
 */
export const signRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
  } as SignOptions);
};

/**
 * Legacy wrapper to maintain backward compatibility with signToken()
 */
export const signToken = signAccessToken;

/**
 * Verify Access Token
 */
export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, ACCESS_TOKEN_SECRET) as TokenPayload;
};

/**
 * Verify Refresh Token
 */
export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(token, REFRESH_TOKEN_SECRET) as TokenPayload;
};

/**
 * Legacy wrapper to maintain backward compatibility with verifyToken()
 */
export const verifyToken = verifyAccessToken;