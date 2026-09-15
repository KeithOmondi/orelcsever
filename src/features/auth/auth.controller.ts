// src/features/auth/auth.controller.ts
//
// HTTP layer for the auth feature.
//
//   - POST /auth/register        — admin only, create a user account
//   - POST /auth/login/request-otp — step 1, email an OTP
//   - POST /auth/login/verify-otp  — step 2, verify OTP, issue tokens,
//                                    set refresh cookie
//   - POST /auth/refresh         — rotate the access token from the
//                                    refresh cookie
//   - GET  /auth/me              — return the current user
//
// Controllers do four things and nothing else:
//   1. Pull validated data off the request.
//   2. Call the service.
//   3. Shape the response (including cookies).
//   4. Let `catchAsync` funnel errors to the global error handler.
//
// No JWT verification here. The refresh handler delegates to the
// service, which owns the JsonWebTokenError → AppError(401) mapping.
// Doing it inline in the controller (as it once was) threw raw JWT
// errors that surfaced as 500s.
//
// Cookie configuration is critical for cross-site deployments:
//   - `secure: true` in production (HTTPS only).
//   - `sameSite: 'none'` in production. The frontend (Vercel) and
//     backend (Render) are different origins, so the cookie is
//     cross-site. `'lax'` and `'strict'` both suppress the cookie on
//     cross-site fetch, which makes /refresh always fail with
//     "Refresh token required".
//   - `httpOnly: true` so the cookie is not readable from JS.
//   - `sameSite: 'none'` REQUIRES `secure: true`, which is why they
//     toggle together on `isProduction`.

import { Request, Response } from 'express';
import * as authService from './auth.service';
import { catchAsync } from '../../utils/catchasync';
import { sendResponse } from '../../utils/Apiresponse';
import { AppError } from '../../utils/Apperror';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Shared cookie options for the refresh token. Extracted so the
 * settings live in one place — changing them changes every issuance
 * and clearance path.
 */
const refreshCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
};

// POST /auth/register — admin-only, see auth.routes.ts
export const registerHandler = catchAsync(async (req: Request, res: Response) => {
  const user = await authService.register(req.body);
  sendResponse(res, 201, { user }, 'Account created successfully');
});

// POST /auth/login/request-otp — step 1: submit PJ number, get an emailed code.
export const requestOtpHandler = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.requestOtp(req.body);

  sendResponse(
    res,
    200,
    null,
    `A login code has been sent to ${result.email}`
  );
});

// POST /auth/login/verify-otp — step 2: submit PJ number + code,
// receive access & refresh tokens. The refresh token is delivered as
// an HttpOnly cookie; the access token is in the JSON body.
export const verifyOtpHandler = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.verifyOtp(req.body);

  res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());

  sendResponse(res, 200, result, 'Logged in successfully');
});

// POST /auth/refresh — issue a new access token from the refresh cookie.
//
// The cookie is set by verify-otp and cleared by the client calling
// this endpoint after a failure, or by a logout route (not implemented).
// `req.body.refreshToken` is a fallback for non-browser clients that
// can't use cookies — the same value is accepted from either source.
export const refreshTokenHandler = catchAsync(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

  if (!refreshToken) {
    throw new AppError('Refresh token required', 401);
  }

  // Delegate to the service. It owns the error mapping: a bad
  // signature becomes AppError(401), an inactive account becomes
  // AppError(403), and both reach the client as meaningful JSON
  // instead of a 500.
  const result = await authService.refreshAccessToken(refreshToken);

  sendResponse(res, 200, result, 'Token refreshed successfully');
});

// GET /auth/me — requires `protect` middleware to have run first
export const meHandler = catchAsync(async (req: Request, res: Response) => {
  const user = await authService.getProfile(req.user!.id);
  sendResponse(res, 200, user);
});