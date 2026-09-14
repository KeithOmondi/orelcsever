// src/middleware/upload.middleware.ts
//
// Multer in memory-only mode. Nothing is ever written to disk — the
// buffer is passed straight to Cloudinary, then discarded.

import multer from 'multer';
import { AppError } from '../utils/Apperror';
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from '../utils/upload';

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype as never)) {
      return cb(null, true);
    }
    cb(
      new AppError(
        `Unsupported file type: ${file.mimetype}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}.`,
        400,
      ),
    );
  },
});