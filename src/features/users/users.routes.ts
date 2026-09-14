// features/users/users.routes.ts
import { Router } from 'express';
import {
  createUserHandler,
  getUsersHandler,
  getUserByIdHandler,
  updateUserHandler,
  toggleUserStatusHandler,
  deleteUserHandler,
  getUserStatsHandler,
  getUserStationsHandler,
} from './users.controller';
import { protect, adminOnly } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { validateQuery } from '../../middleware/validateQuery.middleware';
import {
  createUserSchema,
  updateUserSchema,
  getUsersQuerySchema,
  userIdSchema,
  toggleUserStatusSchema,
} from './users.validation';

const router = Router();

// ============================================================
// ✅ All routes require authentication and admin access
// ============================================================
router.use(protect);
router.use(adminOnly);

// ============================================================
// ✅ User Routes
// ============================================================

// GET /api/users/stats - Get user statistics (no validation needed)
router.get('/stats', getUserStatsHandler);

// GET /api/users/stations - Get unique stations from users (no validation needed)
router.get('/stations', getUserStationsHandler);

// GET /api/users - Get all users with pagination and filtering
// ✅ Use validateQuery for GET requests
router.get(
  '/',
  validateQuery(getUsersQuerySchema),
  getUsersHandler
);

// POST /api/users - Create a new user
router.post(
  '/',
  validate(createUserSchema),
  createUserHandler
);

// GET /api/users/:id - Get a user by ID
// ✅ Use validateQuery for params or skip validation
router.get(
  '/:id',
  getUsersHandler // Skip validation or use validateParams
);

// PUT /api/users/:id - Update a user
router.put(
  '/:id',
  validate(userIdSchema),
  validate(updateUserSchema),
  updateUserHandler
);

// PATCH /api/users/:id/status - Toggle user active status
router.patch(
  '/:id/status',
  validate(toggleUserStatusSchema),
  toggleUserStatusHandler
);

// DELETE /api/users/:id - Delete a user
router.delete(
  '/:id',
  validate(userIdSchema),
  deleteUserHandler
);

export default router;