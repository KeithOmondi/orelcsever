// src/utils/upload.ts
//
// Thin helpers around the Cloudinary SDK.
//
// Uploads always take a Buffer, never a file path. The caller is
// responsible for getting the bytes — multer does that for HTTP routes.
// Buffer-in keeps these helpers usable from tests, scripts, and future
// job queues without any refactor.
//
// Resource type
// ─────────────
// Cloudinary stores an asset under one of three resource types:
// `image`, `raw`, or `video`. The type determines how Cloudinary
// serves the asset:
//
//   - `image` (the default): the asset goes through Cloudinary's image
//     pipeline. JPEGs, PNGs, WebP work as expected. **PDFs uploaded as
//     `image` are served as a page-1 render**, not the original bytes —
//     and if PDF delivery isn't enabled in the Cloudinary account,
//     requests are rejected with a 401. Using `image` for a PDF is
//     almost never what you want.
//
//   - `raw`: the asset is served byte-for-byte with its stored
//     Content-Type. Correct for PDFs, DOCX, XLSX, ZIP, and any binary
//     file that must be downloaded or rendered by a viewer other than
//     Cloudinary's image pipeline.
//
//   - `video`: for video files.
//
// Callers choose the type via `UploadOptions.resourceType`. The default
// is `image` so existing call sites (hero slides, judge portraits) keep
// working unchanged. Upload paths for PDFs MUST pass `resourceType:
// 'raw'` explicitly — see `resourceTypeForMime` below for a helper.

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

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Cloudinary resource types we support. Kept as a narrow union rather
 * than the SDK's `string` so callers get autocomplete and the compiler
 * catches typos.
 */
export type CloudinaryResourceType = 'image' | 'raw' | 'video';

export interface UploadResult {
  url: string;
  publicId: string;
  /** Null for `raw` uploads — Cloudinary has no dimensions to report. */
  width: number | null;
  /** Null for `raw` uploads. */
  height: number | null;
  format: string;
  bytes: number;
  /**
   * The resource type the asset was stored under. Callers that later
   * need to delete or transform the asset should pass this back to
   * Cloudinary — `destroy` and transform calls need the same type.
   */
  resourceType: CloudinaryResourceType;
}

export interface UploadOptions {
  /** Sub-folder under CLOUDINARY_ROOT. e.g. 'hero/slides'. */
  folder: string;
  /** Optional public id to overwrite in place. */
  publicId?: string;
  /** Optional tags for later filtering in the Cloudinary console. */
  tags?: string[];
  /**
   * Cloudinary resource type. Defaults to 'image'.
   *
   * Pass 'raw' for PDFs and other binary files. See the module header
   * for why this matters.
   */
  resourceType?: CloudinaryResourceType;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return the Cloudinary resource type that suits a given MIME type.
 *
 * PDFs and other non-image binaries go to `raw`; images stay `image`.
 * This is the only place in the codebase that knows the mapping, so
 * upload routes can pass a file's MIME and get back the right type.
 *
 * Unknown MIME types default to `raw` — a safe choice, because `image`
 * would silently transform the asset. If the type isn't in
 * ALLOWED_MIME_TYPES, `uploadBuffer` will have rejected the request
 * before this is called anyway.
 */
export const resourceTypeForMime = (
  mimeType: string | undefined,
): CloudinaryResourceType => {
  if (!mimeType) return 'raw';
  if (mimeType === 'application/pdf') return 'raw';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'raw';
};

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
 *
 * The `resource_type` option is passed through to the SDK and echoed
 * back in the returned `UploadResult.resourceType` so callers don't
 * have to remember which type they used.
 */
const uploadStream = (
  buffer: Buffer,
  options: Record<string, unknown>,
  resourceType: CloudinaryResourceType,
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
          url:          result.secure_url,
          publicId:     result.public_id,
          // `raw` resources have no `width` / `height` — the SDK leaves
          // them undefined. Normalize to null so the type is honest.
          width:        result.width  ?? null,
          height:       result.height ?? null,
          format:       result.format,
          bytes:        result.bytes,
          resourceType,
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
 * Resource type defaults to `image`. For PDFs and other binaries, pass
 * `resourceType: 'raw'` — or use `resourceTypeForMime(file.mimetype)` to
 * derive it automatically.
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

  // Caller-specified type wins; otherwise derive from MIME; otherwise
  // fall back to `image` (the SDK default, and the right answer for
  // every non-PDF upload path in the codebase).
  const resourceType =
    options.resourceType ?? resourceTypeForMime(mimeType) ?? 'image';

  const folder = `${CLOUDINARY_ROOT}/${options.folder.replace(/^\/+|\/+$/g, '')}`;

  return uploadStream(
    buffer,
    {
      folder,
      public_id: options.publicId,
      overwrite: Boolean(options.publicId),
      invalidate: true,
      resource_type: resourceType,
      tags: options.tags,
    },
    resourceType,
  );
};

/**
 * Delete an asset by its public id.
 *
 * The `resourceType` argument must match the type the asset was uploaded
 * under. Cloudinary treats `image/foo` and `raw/foo` as different
 * assets even when the public id string is identical, so a delete with
 * the wrong type is a silent no-op — the asset stays.
 *
 * Silent on "not found" — deleting a missing asset is not an error
 * worth surfacing to the caller.
 */
export const deleteAsset = async (
  publicId: string,
  resourceType: CloudinaryResourceType = 'image',
): Promise<void> => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      invalidate: true,
      resource_type: resourceType,
    });
  } catch {
    // Swallow. Logging a missing asset is noise; the caller can't do
    // anything useful with the failure either way.
  }
};

/**
 * Replace an asset: upload the new buffer, then delete the old one.
 * Returns the new UploadResult. If the upload fails, the old asset is
 * left untouched.
 *
 * The `oldResourceType` must match the type the previous asset was
 * uploaded under. If you don't know it, pass the same `resourceType` in
 * `options` — most call sites re-upload to the same folder with the
 * same file type, so this is the common case.
 */
export const replaceAsset = async (
  oldPublicId: string | null,
  buffer: Buffer,
  options: UploadOptions,
  mimeType?: string,
  oldResourceType: CloudinaryResourceType = 'image',
): Promise<UploadResult> => {
  const result = await uploadBuffer(buffer, options, mimeType);
  if (oldPublicId && oldPublicId !== result.publicId) {
    await deleteAsset(oldPublicId, oldResourceType);
  }
  return result;
};