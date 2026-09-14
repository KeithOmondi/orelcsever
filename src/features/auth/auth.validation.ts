import { z } from 'zod';

export const registerSchema = z.object({
  pjNumber: z.string().min(1, 'PJ number is required.'),
  fullName: z.string().min(1, 'Full name is required.'),
  email: z.string().email('A valid email is required.'),
  phone: z.string().optional(),
  station: z.string().min(1, 'Station is required.'),
  designation: z.string().min(1, 'Designation is required.'),
  role: z.enum(['registrar', 'deputy_registrar']), // adjust to your actual role values
});

export const requestOtpSchema = z.object({
  pjNumber: z.string().min(1, 'PJ number is required.'),
});

export const verifyOtpSchema = z.object({
  pjNumber: z.string().min(1, 'PJ number is required.'),
  otp: z.string().length(6, 'Code must be 6 digits.'), // adjust length to match generateOtp()
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().optional(), // Can be passed in body or extracted from cookies in controller
});