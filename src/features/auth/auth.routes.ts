// src/features/auth/auth.routes.ts
//
// Route wiring for the auth feature.
//
// Public:
//   POST /auth/login/request-otp   — step 1 of two-step login
//   POST /auth/login/verify-otp    — step 2, sets refresh cookie
//   POST /auth/refresh             — rotates the access token
//
// Protected:
//   GET  /auth/me                  — current user profile
//
// Admin only:
//   POST /auth/register            — create a user account
//
// Public routes skip auth middleware. The refresh endpoint reads the
// token from an HttpOnly cookie; the schema makes the body field
// optional so a cookie-only request passes validation.

import { Router } from 'express';
import {
  registerHandler,
  requestOtpHandler,
  verifyOtpHandler,
  refreshTokenHandler,
  meHandler,
} from './auth.controller';
import { protect, adminOnly } from '../../middleware/auth.middleware';
import {
  registerSchema,
  requestOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
} from './auth.validation';
import { validate } from '../../middleware/validate.middleware';

const router = Router();

// ============================================================
// Public routes (no authentication required)
// ============================================================

// Two-step, password-less login.
router.post('/login/request-otp', validate(requestOtpSchema), requestOtpHandler);
router.post('/login/verify-otp', validate(verifyOtpSchema), verifyOtpHandler);

// Refresh endpoint. Reads the token from an HttpOnly cookie; the body
// field is an optional fallback for non-browser clients.
router.post('/refresh', validate(refreshTokenSchema), refreshTokenHandler);

// ============================================================
// Protected routes
// ============================================================

// GET /api/v1/auth/me — current user profile.
router.get('/me', protect, meHandler);

// ============================================================
// Admin only
// ============================================================

// POST /api/v1/auth/register — create a user account.
router.post(
  '/register',
  protect,
  adminOnly,
  validate(registerSchema),
  registerHandler
);

export default router;