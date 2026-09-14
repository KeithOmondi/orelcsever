// Full user record as stored in the `users` table.

import { Role } from "../../types/roles";

// No password: pj_number is the login identifier, an emailed OTP is the credential.
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

export interface RegisterInput {
  pjNumber: string;
  fullName: string;
  email: string;
  phone?: string;
  station: string;
  designation: string;
  role: Role;
}

export interface RequestOtpInput {
  pjNumber: string;
}

export interface VerifyOtpInput {
  pjNumber: string;
  otp: string;
}

export interface RefreshTokenInput {
  refreshToken: string;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}