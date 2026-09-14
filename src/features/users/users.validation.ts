// features/users/users.validation.ts
import { z } from 'zod';

export const createUserSchema = z.object({
  pjNumber: z.string().min(1, 'PJ number is required'),
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().optional(),
  station: z.string().min(1, 'Station is required'),
  designation: z.string().min(1, 'Designation is required'),
  role: z.enum(['admin', 'dr']), // ✅ Only admin and dr
});

export const updateUserSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').optional(),
  email: z.string().email('Valid email is required').optional(),
  phone: z.string().optional(),
  station: z.string().min(1, 'Station is required').optional(),
  designation: z.string().min(1, 'Designation is required').optional(),
  role: z.enum(['admin', 'dr']).optional(), // ✅ Only admin and dr
  isActive: z.boolean().optional(),
});

export const getUsersQuerySchema = z.object({
  page: z.string().optional().transform((val) => val ? Number(val) : 1).pipe(
    z.number().int().min(1)
  ),
  limit: z.string().optional().transform((val) => val ? Number(val) : 20).pipe(
    z.number().int().min(1).max(100)
  ),
  search: z.string().optional(),
  role: z.enum(['admin', 'dr']).optional(), // ✅ Only admin and dr
  station: z.string().optional(),
  isActive: z.string().optional().transform((val) => val === 'true'),
});

// users.validation.ts
export const userIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid user ID format'),
  }),
});

export const toggleUserStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid user ID format'),
  }),
  body: z.object({
    isActive: z.boolean(),
  }),
});

// Export types
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type GetUsersQuery = z.infer<typeof getUsersQuerySchema>;
export type UserIdParams = z.infer<typeof userIdSchema>;
export type ToggleUserStatusInput = z.infer<typeof toggleUserStatusSchema>;