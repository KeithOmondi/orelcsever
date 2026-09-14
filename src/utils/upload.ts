// src/utils/upload.ts
//
// Thin helpers around the Cloudinary SDK.
//
// Uploads always take a Buffer, never a file path. The caller is
// responsible for getting the bytes — multer does that for HTTP routes.
// Buffer-in keeps these helpers usable from tests, scripts, and future
// job queues without any refactor.

import { Readable } from 'stream';
import cloudinary from '../config/cloudinary';
import { AppError } from './Apperror';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Root folder in Cloudinary. Every asset is namespaced under this. */
export const CLOUDINARY_ROOT = 'elc';

/** Max upload size. Must match the multer limit in the route. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

/** Allowed MIME types. Checked twice — once by multer, once here. */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/**
 * Cloudinary treats PDFs as `image` resources (page 1 is rendered as the
 * preview). Everything else stays `image` too, so `resource_type` is
 * always 'image' regardless of MIME. If you later add audio/video/raw
 * uploads, this needs to become a per-file decision.
 */
const RESOURCE_TYPE = 'image';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UploadResult {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

export interface UploadOptions {
  /** Sub-folder under CLOUDINARY_ROOT. e.g. 'hero/slides'. */
  folder: string;
  /** Optional public id to overwrite in place. */
  publicId?: string;
  /** Optional tags for later filtering in the Cloudinary console. */
  tags?: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Cloudinary's uploader accepts a stream, a path, or a base64 data URI.
 * The SDK types don't advertise `Buffer`, but the Node SDK handles it
 * fine via the internal upload_stream path. This wraps the buffer in a
 * Readable so the signature is stable across SDK versions.
 */
const bufferToStream = (buffer: Buffer): Readable => {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
};

/**
 * Wraps `cloudinary.uploader.upload_stream` in a promise. The SDK is
 * callback-based; this is the only place we adapt it.
 */
const uploadStream = (
  buffer: Buffer,
  options: Record<string, unknown>,
): Promise<UploadResult> =>
  new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error || !result) {
          return reject(
            new AppError(
              error?.message ?? 'Cloudinary upload failed.',
              502,
            ),
          );
        }
        resolve({
          url:      result.secure_url,
          publicId: result.public_id,
          width:    result.width,
          height:   result.height,
          format:   result.format,
          bytes:    result.bytes,
        });
      },
    );

    bufferToStream(buffer).pipe(upload);
  });

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Upload a Buffer to Cloudinary.
 *
 * The caller supplies the sub-folder (e.g. 'hero/slides'); this function
 * prefixes it with CLOUDINARY_ROOT so every asset lives under `elc/...`.
 *
 * Rejects with AppError(400) on empty buffer, oversized file, or bad
 * MIME type. Rejects with AppError(502) if Cloudinary itself fails.
 */
export const uploadBuffer = async (
  buffer: Buffer,
  options: UploadOptions,
  mimeType?: string,
): Promise<UploadResult> => {
  if (!buffer || buffer.length === 0) {
    throw new AppError('No file data provided.', 400);
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new AppError(
      `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`,
      400,
    );
  }

  if (mimeType && !ALLOWED_MIME_TYPES.includes(mimeType as never)) {
    throw new AppError(
      `Unsupported file type: ${mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}.`,
      400,
    );
  }

  const folder = `${CLOUDINARY_ROOT}/${options.folder.replace(/^\/+|\/+$/g, '')}`;

  return uploadStream(buffer, {
    folder,
    public_id: options.publicId,
    overwrite: Boolean(options.publicId),
    invalidate: true,
    resource_type: RESOURCE_TYPE,
    tags: options.tags,
  });
};

/**
 * Delete an asset by its public id. Silent on "not found" — deleting a
 * missing asset is not an error worth surfacing to the caller.
 */
export const deleteAsset = async (publicId: string): Promise<void> => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  } catch {
    // Swallow. Logging a missing asset is noise; the caller can't do
    // anything useful with the failure either way.
  }
};

/**
 * Replace an asset: upload the new buffer, then delete the old one.
 * Returns the new UploadResult. If the upload fails, the old asset is
 * left untouched.
 */
export const replaceAsset = async (
  oldPublicId: string | null,
  buffer: Buffer,
  options: UploadOptions,
  mimeType?: string,
): Promise<UploadResult> => {
  const result = await uploadBuffer(buffer, options, mimeType);
  if (oldPublicId && oldPublicId !== result.publicId) {
    await deleteAsset(oldPublicId);
  }
  return result;
};