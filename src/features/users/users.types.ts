// features/users/users.types.ts
import { Role } from "../../types/roles";

export interface UserRecord {
  id: string;
  pjNumber: string;
  fullName: string;
  email: string;
  phone: string | null;
  station: string;
  designation: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicUser = UserRecord;

export interface CreateUserInput {
  pjNumber: string;
  fullName: string;
  email: string;
  phone?: string;
  station: string;
  designation: string;
  role: Role;
}

export interface UpdateUserInput {
  fullName?: string;
  email?: string;
  phone?: string;
  station?: string;
  designation?: string;
  role?: Role;
  isActive?: boolean;
}

export interface GetUsersQuery {
  page?: number;
  limit?: number;
  search?: string;
  role?: Role;
  station?: string;
  isActive?: boolean;
}

export interface UsersListResponse {
  users: PublicUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}