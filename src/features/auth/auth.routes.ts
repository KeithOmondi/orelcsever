// features/auth/auth.routes.ts
import { Router } from 'express';
import { 
  registerHandler, 
  requestOtpHandler, 
  verifyOtpHandler, 
  refreshTokenHandler, 
  meHandler 
} from './auth.controller';
import { protect, adminOnly } from '../../middleware/auth.middleware';
import { 
  registerSchema, 
  requestOtpSchema, 
  verifyOtpSchema, 
  refreshTokenSchema 
} from './auth.validation';
import { validate } from '../../middleware/validate.middleware';

const router = Router();

// ============================================================
// ✅ Public Routes (No authentication required)
// ============================================================

// Two-step, password-less login
router.post('/login/request-otp', validate(requestOtpSchema), requestOtpHandler);
router.post('/login/verify-otp', validate(verifyOtpSchema), verifyOtpHandler);

// Refresh token endpoint (uses httpOnly cookie)
router.post('/refresh', validate(refreshTokenSchema), refreshTokenHandler);

// ============================================================
// ✅ Protected Routes (Authentication required)
// ============================================================

// GET /api/v1/auth/me - Get current user profile
router.get('/me', protect, meHandler);

// ============================================================
// ✅ Admin Only Routes
// ============================================================

// POST /api/v1/auth/register - Create new user accounts (Admin only)
router.post(
  '/register', 
  protect, 
  adminOnly, 
  validate(registerSchema), 
  registerHandler
);

export default router;