import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const OTP_HASH_ROUNDS = 10;

// 6-digit numeric code, e.g. "042917". crypto.randomInt is cryptographically
// strong (unlike Math.random), which matters since this is a login credential.
export const generateOtp = (): string => {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
};

export const hashOtp = async (otp: string): Promise<string> => {
  return bcrypt.hash(otp, OTP_HASH_ROUNDS);
};

export const compareOtp = async (otp: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(otp, hash);
};