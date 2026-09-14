import { Request, Response } from 'express';
import * as authService from './auth.service';
import { catchAsync } from '../../utils/catchasync';
import { sendResponse } from '../../utils/Apiresponse';
import { AppError } from '../../utils/Apperror';
import { signAccessToken, verifyRefreshToken } from '../../utils/jwt';

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

// POST /auth/login/verify-otp — step 2: submit PJ number + code, get access & refresh tokens.
export const verifyOtpHandler = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.verifyOtp(req.body);

  // Set refresh token in HTTP-only cookie for secure browser storage
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('refreshToken', result.refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  sendResponse(res, 200, result, 'Logged in successfully');
});

export const refreshTokenHandler = catchAsync(async (req: Request, res: Response) => {
  // ✅ Read refresh token from cookie (more secure)
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
  
  if (!refreshToken) {
    throw new AppError('Refresh token required', 401);
  }
  
  // Verify refresh token
  const decoded = verifyRefreshToken(refreshToken);
  
  // Generate new access token
  const accessToken = signAccessToken({
    id: decoded.id,
    email: decoded.email,
    role: decoded.role,
  });
  
  sendResponse(res, 200, { accessToken }, 'Token refreshed successfully');
});

// GET /auth/me — requires `authenticate` middleware to have run first
export const meHandler = catchAsync(async (req: Request, res: Response) => {
  const user = await authService.getProfile(req.user!.id);
  sendResponse(res, 200, user);
});