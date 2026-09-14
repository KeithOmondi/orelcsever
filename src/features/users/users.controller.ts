// features/users/users.controller.ts
import { Request, Response } from 'express';
import * as usersService from './users.service';
import { catchAsync } from '../../utils/catchasync';
import { sendResponse } from '../../utils/Apiresponse';
import { AppError } from '../../utils/Apperror';
import {
  CreateUserInput,
  UpdateUserInput,
  GetUsersQuery,
} from './users.types';
import { Role } from '../../types/roles';

// ============================================================
// POST /api/users
// ============================================================
export const createUserHandler = catchAsync(async (req: Request, res: Response) => {
  console.log('🔍 [Controller] createUser:', req.body);

  const input: CreateUserInput = req.body;
  const user = await usersService.createUser(input);

  console.log('✅ [Controller] User created:', { id: user.id, email: user.email });

  sendResponse(res, 201, { user }, 'User created successfully');
});

// ============================================================
// GET /api/users
// ============================================================
export const getUsersHandler = catchAsync(async (req: Request, res: Response) => {
  const query: GetUsersQuery = {
    page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    search: req.query.search as string | undefined,
    role: req.query.role as Role | undefined,
    station: req.query.station as string | undefined,
    isActive: req.query.isActive ? req.query.isActive === 'true' : undefined,
  };

  console.log('🔍 [Controller] getUsers query:', query);

  const result = await usersService.getUsers(query);

  console.log('✅ [Controller] Users retrieved:', { total: result.total, count: result.users.length });

  sendResponse(res, 200, result, 'Users retrieved successfully');
});

// ============================================================
// GET /api/users/stats
// ============================================================
export const getUserStatsHandler = catchAsync(async (req: Request, res: Response) => {
  console.log('🔍 [Controller] getUserStats');

  const stats = await usersService.getUserStats();

  console.log('✅ [Controller] User stats retrieved:', stats);

  sendResponse(res, 200, stats, 'User statistics retrieved successfully');
});

// ============================================================
// GET /api/users/stations
// ============================================================
export const getUserStationsHandler = catchAsync(async (req: Request, res: Response) => {
  console.log('🔍 [Controller] getUserStations');

  const stations = await usersService.getUserStations();

  console.log('✅ [Controller] User stations retrieved:', stations.length);

  sendResponse(res, 200, { stations }, 'Stations retrieved successfully');
});

// ============================================================
// GET /api/users/:id
// ============================================================
export const getUserByIdHandler = catchAsync(async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!id) {
    throw new AppError('User ID is required', 400);
  }

  console.log('🔍 [Controller] getUserById:', id);

  const user = await usersService.getUserById(id);

  console.log('✅ [Controller] User retrieved:', { id: user.id, email: user.email });

  sendResponse(res, 200, { user }, 'User retrieved successfully');
});

// ============================================================
// PUT /api/users/:id
// ============================================================
export const updateUserHandler = catchAsync(async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!id) {
    throw new AppError('User ID is required', 400);
  }

  console.log('🔍 [Controller] updateUser:', { id, body: req.body });

  const input: UpdateUserInput = req.body;
  const user = await usersService.updateUser(id, input);

  console.log('✅ [Controller] User updated:', { id: user.id, email: user.email });

  sendResponse(res, 200, { user }, 'User updated successfully');
});

// ============================================================
// PATCH /api/users/:id/status
// ============================================================
export const toggleUserStatusHandler = catchAsync(async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!id) {
    throw new AppError('User ID is required', 400);
  }

  const { isActive } = req.body;

  if (isActive === undefined || typeof isActive !== 'boolean') {
    throw new AppError('isActive boolean is required', 400);
  }

  console.log('🔍 [Controller] toggleUserStatus:', { id, isActive });

  const user = await usersService.toggleUserStatus(id, isActive);

  console.log('✅ [Controller] User status toggled:', { id: user.id, isActive: user.isActive });

  sendResponse(res, 200, { user }, `User ${isActive ? 'activated' : 'deactivated'} successfully`);
});

// ============================================================
// DELETE /api/users/:id
// ============================================================
export const deleteUserHandler = catchAsync(async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!id) {
    throw new AppError('User ID is required', 400);
  }

  console.log('🔍 [Controller] deleteUser:', id);

  await usersService.deleteUser(id);

  console.log('✅ [Controller] User deleted:', id);

  sendResponse(res, 200, null, 'User deleted successfully');
});