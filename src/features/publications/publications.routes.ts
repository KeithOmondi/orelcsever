// src/features/publications/publications.routes.ts
//
// Route wiring for the Publications feature.
//
// Path layout:
//   /publications                        → public reads
//   /publications/:publicationId         → public read one
//   /publications/admin/*                → admin reads and writes
//   /publications/admin/upload/file      → admin PDF upload (multipart)
//
// Splitting admin routes under `/admin` avoids the collision between
// `/publications/:publicationId` and `/publications/admin/all` —
// without the prefix, `admin` would be parsed as a publicationId.
//
// Declaration order matters. Express matches routes top-to-bottom, so
// any static segment that could also match a `:publicationId` param
// must be declared first:
//   /admin/upload/file  before  /admin/:publicationId
//   /admin/all          before  /admin/:publicationId
//   /admin/pending      before  /admin/:publicationId
//
// Middleware order per route, left to right:
//   1. protect       — populates req.user from the access token
//   2. role gate     — adminOnly or superAdminOnly
//   3. validate      — Zod body/param/query validation
//   4. upload        — multer for the multipart route only
//   5. handler       — the controller
//
// Public routes skip 1–4. The service re-checks roles anyway, so the
// middleware is the first line of defense, not the only one.

import { Router } from 'express';
import * as publicationsController from './publications.controller';
import {
  protect,
  adminOnly,
  superAdminOnly,
} from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { upload } from '../../middleware/upload.middleware';
import {
  createPublicationSchema,
  updatePublicationSchema,
  submitPublicationSchema,
  approvePublicationSchema,
  rejectPublicationSchema,
  publicationIdParamSchema,
  listPublicationsQuerySchema,
} from './publications.validator';

const router = Router();

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /publications
 * List published publications. Paginated, searchable, filterable by
 * category.
 */
router.get(
  '/',
  validate(listPublicationsQuerySchema),
  publicationsController.listPublishedPublicationsHandler,
);

/**
 * GET /publications/:publicationId
 * One published publication, including preview pages. 404 for drafts,
 * pending, and rejected.
 */
router.get(
  '/:publicationId',
  validate(publicationIdParamSchema),
  publicationsController.getPublishedPublicationHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — uploads
//
// Declared before /admin/:publicationId so the static "upload" segment
// is matched first. The verb (POST) also disambiguates from the PATCH
// and DELETE on /admin/:publicationId, but ordering removes any doubt.
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /publications/admin/upload/file
 * Multipart PDF upload.
 * Form field: "file".
 *
 * No `validate` — multipart, not JSON. Multer's `fileFilter` enforces
 * the MIME allowlist before the handler runs.
 *
 * Returns: { url, publicId, bytes, fileSize, pages }. The client
 * copies these onto the publication payload as fileUrl, filePublicId,
 * fileBytes, fileSize, and pages.
 */
router.post(
  '/admin/upload/file',
  protect,
  adminOnly,
  upload.single('file'),
  publicationsController.uploadPublicationFileHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — reads
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /publications/admin/all
 * Every publication, any status.
 *
 * Declared BEFORE /admin/:publicationId so "all" isn't parsed as a UUID.
 */
router.get(
  '/admin/all',
  protect,
  adminOnly,
  publicationsController.listAllPublicationsHandler,
);

/**
 * GET /publications/admin/pending
 * Publications waiting on review.
 *
 * Declared BEFORE /admin/:publicationId so "pending" isn't parsed as a
 * UUID.
 */
router.get(
  '/admin/pending',
  protect,
  adminOnly,
  publicationsController.listPendingPublicationsHandler,
);

/**
 * GET /publications/admin/:publicationId
 * One publication, any status, including audit fields and preview
 * pages.
 */
router.get(
  '/admin/:publicationId',
  protect,
  adminOnly,
  validate(publicationIdParamSchema),
  publicationsController.getPublicationHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — writes
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /publications/admin
 * Create a new draft publication.
 *
 * Body: { payload: PublicationInput }
 */
router.post(
  '/admin',
  protect,
  adminOnly,
  validate(createPublicationSchema),
  publicationsController.createPublicationHandler,
);

/**
 * PATCH /publications/admin/:publicationId
 * Update a publication the caller owns. Drafts and rejected only.
 *
 * Body: { payload: Partial<PublicationInput> }
 */
router.patch(
  '/admin/:publicationId',
  protect,
  adminOnly,
  validate(publicationIdParamSchema),
  validate(updatePublicationSchema),
  publicationsController.updatePublicationHandler,
);

/**
 * POST /publications/admin/:publicationId/submit
 * Draft or rejected → pending.
 */
router.post(
  '/admin/:publicationId/submit',
  protect,
  adminOnly,
  validate(publicationIdParamSchema),
  validate(submitPublicationSchema),
  publicationsController.submitPublicationHandler,
);

/**
 * DELETE /publications/admin/:publicationId
 * Delete the caller's own draft or rejected publication.
 *
 * The service destroys the Cloudinary file referenced by the row.
 */
router.delete(
  '/admin/:publicationId',
  protect,
  adminOnly,
  validate(publicationIdParamSchema),
  publicationsController.deletePublicationHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN — review
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /publications/admin/:publicationId/approve
 * Publish a pending publication.
 *
 * Body: { reviewNote?: string }
 */
router.post(
  '/admin/:publicationId/approve',
  protect,
  superAdminOnly,
  validate(publicationIdParamSchema),
  validate(approvePublicationSchema),
  publicationsController.approvePublicationHandler,
);

/**
 * POST /publications/admin/:publicationId/reject
 * Decline a pending publication. A review note is required.
 *
 * Body: { reviewNote: string }
 */
router.post(
  '/admin/:publicationId/reject',
  protect,
  superAdminOnly,
  validate(publicationIdParamSchema),
  validate(rejectPublicationSchema),
  publicationsController.rejectPublicationHandler,
);

export default router;