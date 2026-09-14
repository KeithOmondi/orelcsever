// src/config/cloudinary.ts
//
// Initialises the Cloudinary SDK once and exports the configured client.
// Mirrors the shape of config/db.ts — one module, one shared instance.
//
// Credentials are validated once in config/env.ts (fail-fast at boot,
// single source of truth) — this module just consumes them.

import { v2 as cloudinary } from 'cloudinary';
import { env } from './env';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key:    env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure:     true, // always return https URLs
});

export { cloudinary };
export default cloudinary;