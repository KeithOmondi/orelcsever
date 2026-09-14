// config/env.ts

import dotenv from 'dotenv';
import { z } from 'zod';

// Load variables from .env into process.env
dotenv.config();

// Helper to validate individual URLs
const isValidUrl = (url: string) => {
  try {
    new URL(url.trim());
    return true;
  } catch {
    return false;
  }
};

const envSchema = z
  .object({
    // Node Environment
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // Server Port
    PORT: z.coerce.number().default(5000),

    // ✅ CLIENT_URL - for the Station Requirements app
    CLIENT_URL: z
      .string()
      .optional()
      .default('http://localhost:5173')
      .refine(
        (val) => {
          if (!val) return true;
          return val.split(',').every((origin) => isValidUrl(origin.trim()));
        },
        {
          message:
            'CLIENT_URL must be a valid URL or comma-separated list of URLs (e.g., http://localhost:5173,https://app.domain.com)',
        }
      ),

    // ✅ Keep CLIENT_ORIGIN for backward compatibility (optional)
    CLIENT_ORIGIN: z
      .string()
      .optional()
      .refine(
        (val) => {
          if (!val) return true;
          return val.split(',').every((origin) => isValidUrl(origin.trim()));
        },
        {
          message:
            'CLIENT_ORIGIN must be a valid URL or comma-separated list of URLs',
        }
      ),

    // Database URL (PostgreSQL / Neon)
    DATABASE_URL: z.string().url({
      message: 'DATABASE_URL must be a valid PostgreSQL connection string',
    }),

    // Access Token Secrets & Expiry
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long').optional(),
    ACCESS_TOKEN_SECRET: z.string().min(32, 'ACCESS_TOKEN_SECRET must be at least 32 characters long').optional(),
    ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),

    // Refresh Token Secrets & Expiry
    REFRESH_TOKEN_SECRET: z.string().min(32, 'REFRESH_TOKEN_SECRET must be at least 32 characters long').optional(),
    REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),

    // Brevo (transactional email)
    BREVO_API_KEY: z.string().min(1, 'BREVO_API_KEY is required'),
    EMAIL_FROM: z.string().email('EMAIL_FROM must be a valid email address'),
    EMAIL_FROM_NAME: z.string().default('Judiciary Portal'),

    // Cloudinary (media uploads)
    CLOUDINARY_CLOUD_NAME: z.string().min(1, 'CLOUDINARY_CLOUD_NAME is required'),
    CLOUDINARY_API_KEY: z.string().min(1, 'CLOUDINARY_API_KEY is required'),
    CLOUDINARY_API_SECRET: z.string().min(1, 'CLOUDINARY_API_SECRET is required'),
  })
  .superRefine((data, ctx) => {
    // Ensure at least one Access Token secret is provided
    const accessTokenSecret = data.ACCESS_TOKEN_SECRET || data.JWT_SECRET;
    if (!accessTokenSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either ACCESS_TOKEN_SECRET or JWT_SECRET must be provided and be at least 32 characters long',
        path: ['ACCESS_TOKEN_SECRET'],
      });
    }

    // Require separate REFRESH_TOKEN_SECRET in production for security best practices
    if (data.NODE_ENV === 'production' && !data.REFRESH_TOKEN_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'REFRESH_TOKEN_SECRET is required in production environment',
        path: ['REFRESH_TOKEN_SECRET'],
      });
    }
  });

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables detected:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }

  // Normalize access and refresh secrets with fallbacks for development/tests
  const data = result.data;
  const accessSecret = data.ACCESS_TOKEN_SECRET || data.JWT_SECRET!;
  const refreshSecret = data.REFRESH_TOKEN_SECRET || accessSecret;

  // ✅ Build allowed origins from CLIENT_URL and PROCEEDINGS_URL
  const allowedOrigins: string[] = [];

  // Add from CLIENT_URL
  if (data.CLIENT_URL) {
    data.CLIENT_URL.split(',').forEach((origin) => {
      const trimmed = origin.trim();
      if (trimmed) allowedOrigins.push(trimmed);
    });
  }

  // ✅ Fallback: Add from CLIENT_ORIGIN for backward compatibility
  if (data.CLIENT_ORIGIN) {
    data.CLIENT_ORIGIN.split(',').forEach((origin) => {
      const trimmed = origin.trim();
      if (trimmed) allowedOrigins.push(trimmed);
    });
  }

  // ✅ Remove duplicates
  const uniqueOrigins = [...new Set(allowedOrigins)];

  console.log('✅ Allowed CORS origins:', uniqueOrigins);

  return {
    ...data,
    ACCESS_TOKEN_SECRET: accessSecret,
    REFRESH_TOKEN_SECRET: refreshSecret,
    ALLOWED_ORIGINS: uniqueOrigins, // ✅ Combined array for CORS
    CLIENT_ORIGINS: uniqueOrigins, // ✅ Alias for backward compatibility
  };
};

// Export validated and typed environment configuration
export const env = parseEnv();

// Export type inferred directly from schema
export type Env = ReturnType<typeof parseEnv>;