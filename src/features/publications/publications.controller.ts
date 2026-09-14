// src/features/publications/publications.controller.ts
//
// HTTP layer for the Publications feature.
//
// Controllers do four things and nothing else:
//   1. Pull validated data off the request (body / params / query / user).
//   2. Call the service.
//   3. Pass the result to `sendResponse`.
//   4. Let `catchAsync` funnel errors to the global error handler.
//
// No business logic. No SQL. No role checks beyond what the middleware
// already enforced — the service re-verifies authorization anyway.

import { Request, Response } from 'express';
import * as publicationsService from './publications.service';
import { catchAsync } from '../../utils/catchasync';
import { sendResponse } from '../../utils/Apiresponse';
import { AppError } from '../../utils/Apperror';
import type { PublicationFileUploadResult } from './publications.types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Express 5 types `req.params.*` as `string | string[]`.
 * Every route we define has single-valued params, so this narrows the
 * type once instead of casting at each callsite.
 */
const param = (req: Request, key: string): string => {
  const value = req.params[key];
  if (typeof value !== 'string') {
    throw new AppError(`${key} must be a single value.`, 400);
  }
  return value;
};

/**
 * Format a byte count into a human-readable size string.
 *
 * Matches the shape the validator accepts: `^\d+(\.\d+)?\s?(B|KB|MB|GB)$`,
 * e.g. "2.4 MB". Rounds to one decimal place above 1 KB.
 *
 * Lives in the controller rather than the service because it's a
 * presentation concern — the service stores whatever string it's
 * given, and the DB doesn't care about units. The upload handler
 * computes it once from Cloudinary's raw `bytes` so the client
 * doesn't have to.
 */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  // One decimal place, trimming a trailing ".0" so "2.4 MB" and "3 MB"
  // both render naturally.
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
};

// ─── Public ──────────────────────────────────────────────────────────────────

/**
 * GET /publications
 * Public. List published publications. Paginated, searchable,
 * filterable by category.
 *
 * Query: { search?, category?, page?, limit? }
 */
export const listPublishedPublicationsHandler = catchAsync(
  async (req: Request, res: Response) => {
    // `validate.middleware.ts` stores parsed query on req.validatedQuery.
    // Fall back to req.query for safety if the middleware wasn't mounted.
    const parsed = (req as any).validatedQuery ?? req.query;
    const result = await publicationsService.listPublishedPublications(parsed);
    sendResponse(res, 200, result);
  },
);

/**
 * GET /publications/:publicationId
 * Public. Returns a single published publication, including its
 * preview pages, or 404.
 */
export const getPublishedPublicationHandler = catchAsync(
  async (req: Request, res: Response) => {
    const publicationId = param(req, 'publicationId');
    const publication =
      await publicationsService.getPublishedPublicationById(publicationId);
    sendResponse(res, 200, publication);
  },
);

// ─── Admin — reads ───────────────────────────────────────────────────────────

/**
 * GET /publications/admin/all
 * Admin. Every publication regardless of status, newest first.
 */
export const listAllPublicationsHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const publications = await publicationsService.listAllPublications();
    sendResponse(res, 200, publications);
  },
);

/**
 * GET /publications/admin/pending
 * Admin. Publications waiting on review.
 */
export const listPendingPublicationsHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const publications = await publicationsService.listPendingPublications();
    sendResponse(res, 200, publications);
  },
);

/**
 * GET /publications/admin/:publicationId
 * Admin. Full publication, any status, including audit fields and
 * preview pages.
 */
export const getPublicationHandler = catchAsync(
  async (req: Request, res: Response) => {
    const publicationId = param(req, 'publicationId');
    const publication =
      await publicationsService.getPublicationById(publicationId);
    sendResponse(res, 200, publication);
  },
);

// ─── Admin — writes ──────────────────────────────────────────────────────────

/**
 * POST /publications/admin
 * Admin. Creates a new draft publication.
 *
 * Body: { payload: PublicationInput }
 */
export const createPublicationHandler = catchAsync(
  async (req: Request, res: Response) => {
    const { payload } = req.body;
    const publication = await publicationsService.createPublication(
      req.user!.id,
      req.user!.role,
      payload,
    );
    sendResponse(res, 201, publication, 'Publication created.');
  },
);

/**
 * PATCH /publications/admin/:publicationId
 * Admin. Updates a publication the caller owns. Only drafts and
 * rejected publications can be edited.
 *
 * Body: { payload: Partial<PublicationInput> }
 */
export const updatePublicationHandler = catchAsync(
  async (req: Request, res: Response) => {
    const publicationId = param(req, 'publicationId');
    const { payload } = req.body;
    const publication = await publicationsService.updatePublication(
      req.user!.id,
      publicationId,
      payload,
    );
    sendResponse(res, 200, publication, 'Publication updated.');
  },
);

/**
 * POST /publications/admin/:publicationId/submit
 * Admin. Moves a draft or rejected publication to pending.
 */
export const submitPublicationHandler = catchAsync(
  async (req: Request, res: Response) => {
    const publicationId = param(req, 'publicationId');
    const publication = await publicationsService.submitPublication(
      req.user!.id,
      publicationId,
    );
    sendResponse(res, 200, publication, 'Publication submitted for review.');
  },
);

/**
 * DELETE /publications/admin/:publicationId
 * Admin. Deletes the caller's own draft or rejected publication.
 *
 * The service destroys the Cloudinary file referenced by the row.
 */
export const deletePublicationHandler = catchAsync(
  async (req: Request, res: Response) => {
    const publicationId = param(req, 'publicationId');
    await publicationsService.deletePublication(req.user!.id, publicationId);
    sendResponse(res, 200, null, 'Publication deleted.');
  },
);

// ─── Super admin — review ────────────────────────────────────────────────────

/**
 * POST /publications/admin/:publicationId/approve
 * Super admin. Publishes a pending publication.
 *
 * Body: { reviewNote?: string }
 */
export const approvePublicationHandler = catchAsync(
  async (req: Request, res: Response) => {
    const publicationId = param(req, 'publicationId');
    const { reviewNote } = req.body;
    const publication = await publicationsService.approvePublication(
      req.user!.id,
      req.user!.role,
      publicationId,
      reviewNote,
    );
    sendResponse(res, 200, publication, 'Publication published.');
  },
);

/**
 * POST /publications/admin/:publicationId/reject
 * Super admin. Declines a pending publication without publishing.
 *
 * Body: { reviewNote: string }
 */
export const rejectPublicationHandler = catchAsync(
  async (req: Request, res: Response) => {
    const publicationId = param(req, 'publicationId');
    const { reviewNote } = req.body;
    const publication = await publicationsService.rejectPublication(
      req.user!.id,
      req.user!.role,
      publicationId,
      reviewNote,
    );
    sendResponse(res, 200, publication, 'Publication rejected.');
  },
);

// ─── Admin — upload ──────────────────────────────────────────────────────────

/**
 * POST /publications/admin/upload/file
 * Admin. Multipart upload of a single PDF.
 *
 * Body: multipart/form-data with a file in the "file" field.
 *
 * Returns `PublicationFileUploadResult`:
 *     {
 *       url: string,        // Cloudinary secure_url
 *       publicId: string,   // Cloudinary public_id
 *       bytes: number,      // raw byte count
 *       fileSize: string,   // human-readable, e.g. "2.4 MB"
 *       pages: []           // extracted previews, or [] if none
 *     }
 *
 * The client copies `url`, `publicId`, `bytes`, and `fileSize` onto the
 * publication payload as `fileUrl`, `filePublicId`, `fileBytes`, and
 * `fileSize`. `pages` is passed through as-is.
 *
 * Preview extraction is NOT performed here — see the note on `pages` in
 * publications.service.ts. If you want server-side PDF parsing, add it
 * between `uploadBuffer` and `sendResponse` below, and change the
 * `pages` field of the response to the extracted array.
 *
 * No `validate` middleware on this route — the body is multipart, not
 * JSON. Multer's `fileFilter` handles the MIME check before the handler
 * runs.
 */
export const uploadPublicationFileHandler = catchAsync(
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError(
        'No file uploaded. Send a file under the "file" field.',
        400,
      );
    }

    // Imported lazily to keep the controller file focused on HTTP.
    const { uploadBuffer } = await import('../../utils/upload');

    const result = await uploadBuffer(
      req.file.buffer,
      { folder: 'publications/files', tags: ['publications'] },
      req.file.mimetype,
    );

    const payload: PublicationFileUploadResult = {
      url: result.url,
      publicId: result.publicId,
      bytes: result.bytes,
      fileSize: formatBytes(result.bytes),
      // No server-side extraction yet — return an empty array so the
      // client has a stable shape. The reader falls back to
      // "download to view" when `pages` is empty.
      pages: [],
    };

    sendResponse(res, 200, payload, 'File uploaded.');
  },
);