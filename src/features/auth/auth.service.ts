import { query } from '../../config/db';
import { AppError } from '../../utils/Apperror';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { generateOtp, hashOtp, compareOtp } from '../../utils/sendOTP';
import { sendOtpEmail } from '../../utils/sendMail';
import {
  RegisterInput,
  RequestOtpInput,
  VerifyOtpInput,
  AuthResult,
  UserRecord,
  PublicUser,
} from './auth.types';

const OTP_EXPIRY_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const MAX_OTP_ATTEMPTS = 5;

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

const findUserByPjNumber = async (pjNumber: string): Promise<UserRecord | null> => {
  const result = await query('SELECT * FROM users WHERE pj_number = $1', [pjNumber]);
  return result.rowCount ? mapUserRow(result.rows[0]) : null;
};

// Helper function to mask email (e.g. "johndoe@example.com" -> "j***e@example.com")
const maskEmail = (email: string): string => {
  const [localPart, domain] = email.split('@');
  if (!domain) return email;
  if (localPart.length <= 2) {
    return `${localPart[0]}***@${domain}`;
  }
  return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`;
};

export const register = async (input: RegisterInput): Promise<PublicUser> => {
  const existing = await query(
    'SELECT id FROM users WHERE pj_number = $1 OR email = $2',
    [input.pjNumber, input.email]
  );

  if ((existing.rowCount ?? 0) > 0) {
    throw new AppError('An account with this PJ number or email already exists.', 409);
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

// Step 1: look up the user by PJ number, email them a fresh OTP,
// and return their masked email address for frontend UI confirmation.
export const requestOtp = async (input: RequestOtpInput): Promise<{ email: string }> => {
  const user = await findUserByPjNumber(input.pjNumber);

  if (!user) {
    throw new AppError('Invalid PJ number. Kindly contact the admin.', 404);
  }

  if (!user.isActive) {
    throw new AppError('This account is inactive. Kindly contact the admin.', 403);
  }

  // Cooldown: don't let someone spam OTP requests / flood the inbox.
  const recent = await query(
    `SELECT id FROM otps
     WHERE user_id = $1 AND consumed_at IS NULL AND created_at > NOW() - INTERVAL '${OTP_RESEND_COOLDOWN_SECONDS} seconds'
     ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  if ((recent.rowCount ?? 0) > 0) {
    throw new AppError('A code was already sent recently. Please wait before requesting another.', 429);
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await query(
    `INSERT INTO otps (user_id, otp_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, otpHash, expiresAt]
  );

  await sendOtpEmail(user.email, user.fullName, otp, OTP_EXPIRY_MINUTES);

  return { email: maskEmail(user.email) };
};

// Step 2: verify the OTP and issue access & refresh tokens.
export const verifyOtp = async (input: VerifyOtpInput): Promise<AuthResult> => {
  const user = await findUserByPjNumber(input.pjNumber);
  if (!user || !user.isActive) {
    throw new AppError('Invalid or expired otp', 401);
  }

  const otpResult = await query(
    `SELECT * FROM otps
     WHERE user_id = $1 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );

  if (otpResult.rowCount === 0) {
    throw new AppError('No active code found. Request a new one.', 400);
  }

  const otpRow = otpResult.rows[0];

  if (new Date(otpRow.expires_at).getTime() < Date.now()) {
    throw new AppError('This code has expired. Request a new one.', 400);
  }

  if (otpRow.attempts >= MAX_OTP_ATTEMPTS) {
    throw new AppError('Too many incorrect attempts. Request a new code.', 429);
  }

  const matches = await compareOtp(input.otp, otpRow.otp_hash);

  if (!matches) {
    await query('UPDATE otps SET attempts = attempts + 1 WHERE id = $1', [otpRow.id]);
    throw new AppError('Incorrect code.', 400);
  }

  await query('UPDATE otps SET consumed_at = NOW() WHERE id = $1', [otpRow.id]);

  const tokenPayload = { id: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  return { 
    user: toPublicUser(user), 
    accessToken, 
    refreshToken 
  };
};

// Step 3: verify the refresh token and return a new access token.
export const refreshAccessToken = async (token: string): Promise<{ accessToken: string }> => {
  try {
    const payload = verifyRefreshToken(token);
    
    const user = await getProfile(payload.id);
    if (!user.isActive) {
      throw new AppError('This account is inactive.', 403);
    }

    const accessToken = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return { accessToken };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Invalid or expired refresh token.', 401);
  }
};

export const getProfile = async (userId: string): Promise<PublicUser> => {
  const result = await query('SELECT * FROM users WHERE id = $1', [userId]);

  if (result.rowCount === 0) {
    throw new AppError('User not found.', 404);
  }

  return toPublicUser(mapUserRow(result.rows[0]));
};