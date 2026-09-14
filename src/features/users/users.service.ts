// features/users/users.service.ts
import { query } from '../../config/db';
import { AppError } from '../../utils/Apperror';
import {
  UserRecord,
  PublicUser,
  CreateUserInput,
  UpdateUserInput,
  GetUsersQuery,
  UsersListResponse,
} from './users.types';

const mapUserRow = (row: Record<string, any>): UserRecord => ({
  id: row.id,
  pjNumber: row.pj_number,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  station: row.station,
  designation: row.designation,
  role: row.role,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toPublicUser = (user: UserRecord): PublicUser => user;

// ============================================================
// CREATE USER
// ============================================================
export const createUser = async (input: CreateUserInput): Promise<PublicUser> => {
  // Check if user already exists
  const existing = await query(
    'SELECT id FROM users WHERE pj_number = $1 OR email = $2',
    [input.pjNumber, input.email]
  );

  if ((existing.rowCount ?? 0) > 0) {
    throw new AppError('A user with this PJ number or email already exists.', 409);
  }

  const result = await query(
    `INSERT INTO users (pj_number, full_name, email, phone, station, designation, role)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.pjNumber,
      input.fullName,
      input.email,
      input.phone ?? null,
      input.station,
      input.designation,
      input.role,
    ]
  );

  return toPublicUser(mapUserRow(result.rows[0]));
};

// ============================================================
// GET ALL USERS (with pagination and filtering)
// ============================================================
export const getUsers = async (queryParams: GetUsersQuery): Promise<UsersListResponse> => {
  const {
    page = 1,
    limit = 20,
    search,
    role,
    station,
    isActive,
  } = queryParams;

  const validPage = Math.max(1, page);
  const validLimit = Math.min(100, Math.max(1, limit));

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (search) {
    conditions.push(`(pj_number ILIKE $${paramIndex} OR full_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
    values.push(`%${search}%`);
    paramIndex++;
  }

  if (role) {
    conditions.push(`role = $${paramIndex}`);
    values.push(role);
    paramIndex++;
  }

  if (station) {
    conditions.push(`station ILIKE $${paramIndex}`);
    values.push(`%${station}%`);
    paramIndex++;
  }

  if (isActive !== undefined) {
    conditions.push(`is_active = $${paramIndex}`);
    values.push(isActive);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (validPage - 1) * validLimit;

  // Get total count
  const countResult = await query(
    `SELECT COUNT(*) as total FROM users ${whereClause}`,
    values
  );

  const total = parseInt((countResult.rows[0]?.total as string) || '0', 10);

  // Get paginated results
  const result = await query(
    `SELECT * FROM users
     ${whereClause}
     ORDER BY full_name ASC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...values, validLimit, offset]
  );

  const users = result.rows.map(mapUserRow).map(toPublicUser);
  const totalPages = Math.ceil(total / validLimit);

  return {
    users,
    total,
    page: validPage,
    limit: validLimit,
    totalPages,
  };
};

// ============================================================
// GET USER BY ID
// ============================================================
export const getUserById = async (id: string): Promise<PublicUser> => {
  if (!id || typeof id !== 'string' || id.trim() === '') {
    throw new AppError('Valid user ID is required', 400);
  }

  const result = await query('SELECT * FROM users WHERE id = $1', [id.trim()]);

  if (result.rowCount === 0) {
    throw new AppError('User not found.', 404);
  }

  return toPublicUser(mapUserRow(result.rows[0]));
};

// ============================================================
// GET USER BY PJ NUMBER
// ============================================================
export const getUserByPjNumber = async (pjNumber: string): Promise<PublicUser | null> => {
  const result = await query('SELECT * FROM users WHERE pj_number = $1', [pjNumber]);
  return result.rowCount ? toPublicUser(mapUserRow(result.rows[0])) : null;
};

// ============================================================
// UPDATE USER
// ============================================================
export const updateUser = async (id: string, input: UpdateUserInput): Promise<PublicUser> => {
  // Check if user exists
  await getUserById(id);

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.fullName !== undefined) {
    updates.push(`full_name = $${paramIndex}`);
    values.push(input.fullName);
    paramIndex++;
  }

  if (input.email !== undefined) {
    updates.push(`email = $${paramIndex}`);
    values.push(input.email);
    paramIndex++;
  }

  if (input.phone !== undefined) {
    updates.push(`phone = $${paramIndex}`);
    values.push(input.phone);
    paramIndex++;
  }

  if (input.station !== undefined) {
    updates.push(`station = $${paramIndex}`);
    values.push(input.station);
    paramIndex++;
  }

  if (input.designation !== undefined) {
    updates.push(`designation = $${paramIndex}`);
    values.push(input.designation);
    paramIndex++;
  }

  if (input.role !== undefined) {
    updates.push(`role = $${paramIndex}`);
    values.push(input.role);
    paramIndex++;
  }

  if (input.isActive !== undefined) {
    updates.push(`is_active = $${paramIndex}`);
    values.push(input.isActive);
    paramIndex++;
  }

  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }

  // Always update updated_at
  updates.push(`updated_at = CURRENT_TIMESTAMP`);

  values.push(id.trim());

  const result = await query(
    `UPDATE users 
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  if (result.rowCount === 0) {
    throw new AppError('Failed to update user', 500);
  }

  return toPublicUser(mapUserRow(result.rows[0]));
};

// ============================================================
// TOGGLE USER STATUS (Activate/Deactivate)
// ============================================================
export const toggleUserStatus = async (id: string, isActive: boolean): Promise<PublicUser> => {
  // Check if user exists
  await getUserById(id);

  const result = await query(
    `UPDATE users 
     SET is_active = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING *`,
    [isActive, id.trim()]
  );

  if (result.rowCount === 0) {
    throw new AppError('Failed to update user status', 500);
  }

  return toPublicUser(mapUserRow(result.rows[0]));
};

// ============================================================
// DELETE USER
// ============================================================
export const deleteUser = async (id: string): Promise<void> => {
  // Check if user exists
  await getUserById(id);

  const result = await query('DELETE FROM users WHERE id = $1', [id.trim()]);

  if (result.rowCount === 0) {
    throw new AppError('Failed to delete user', 500);
  }
};

// ============================================================
// GET UNIQUE STATIONS FROM USERS
// ============================================================
export const getUserStations = async (): Promise<string[]> => {
  const result = await query(
    'SELECT DISTINCT station FROM users WHERE station IS NOT NULL ORDER BY station ASC'
  );

  if (!result.rows) {
    return [];
  }

  return result.rows.map((row) => row.station as string).filter(Boolean);
};

// ============================================================
// GET USER STATISTICS
// ============================================================
// features/users/users.service.ts - Updated getUserStats
// ============================================================
// GET USER STATISTICS
// ============================================================
export const getUserStats = async (): Promise<{
  totalUsers: number;
  totalAdmins: number;
  totalDRs: number;
  activeUsers: number;
  inactiveUsers: number;
}> => {
  const result = await query(`
    SELECT 
      COUNT(*) as total_users,
      COUNT(*) FILTER (WHERE role = 'admin') as total_admins,
      COUNT(*) FILTER (WHERE role = 'dr') as total_drs,
      COUNT(*) FILTER (WHERE is_active = true) as active_users,
      COUNT(*) FILTER (WHERE is_active = false) as inactive_users
    FROM users
  `);

  const row = result.rows[0];
  return {
    totalUsers: parseInt((row.total_users as string) || '0', 10),
    totalAdmins: parseInt((row.total_admins as string) || '0', 10),
    totalDRs: parseInt((row.total_drs as string) || '0', 10),
    activeUsers: parseInt((row.active_users as string) || '0', 10),
    inactiveUsers: parseInt((row.inactive_users as string) || '0', 10),
  };
};