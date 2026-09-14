// src/features/documents/documents.routes.ts
//
// Route wiring for the Documents feature.
//
// Path layout:
//   /documents                        → public reads
//   /documents/:documentId            → public read one
//   /documents/admin/*                → admin reads and writes
//   /documents/admin/upload/file      → admin PDF upload (multipart)
//
// Splitting admin routes under `/admin` avoids the collision between
// `/documents/:documentId` and `/documents/admin/all` — without the
// prefix, `admin` would be parsed as a documentId.
//
// Declaration order matters. Express matches routes top-to-bottom, so
// any static segment that could also match a `:documentId` param must
// be declared first:
//   /admin/upload/file  before  /admin/:documentId
//   /admin/all          before  /admin/:documentId
//   /admin/pending      before  /admin/:documentId
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
import * as documentsController from './documents.controller';
import {
  protect,
  adminOnly,
  superAdminOnly,
} from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { upload } from '../../middleware/upload.middleware';
import {
  createDocumentSchema,
  updateDocumentSchema,
  submitDocumentSchema,
  approveDocumentSchema,
  rejectDocumentSchema,
  documentIdParamSchema,
  listDocumentsQuerySchema,
} from './documents.validator';

const router = Router();

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /documents
 * List published documents. Paginated, searchable, filterable by
 * category and station.
 */
router.get(
  '/',
  validate(listDocumentsQuerySchema),
  documentsController.listPublishedDocumentsHandler,
);

/**
 * GET /documents/:documentId
 * One published document. 404 for drafts, pending, and rejected.
 */
router.get(
  '/:documentId',
  validate(documentIdParamSchema),
  documentsController.getPublishedDocumentHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — uploads
//
// Declared before /admin/:documentId so the static "upload" segment is
// matched first. The verb (POST) also disambiguates from the PATCH and
// DELETE on /admin/:documentId, but ordering removes any doubt.
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /documents/admin/upload/file
 * Multipart PDF upload.
 * Form field: "file".
 *
 * No `validate` — multipart, not JSON. Multer's `fileFilter` enforces
 * the MIME allowlist before the handler runs.
 *
 * Returns: { url, publicId, bytes, fileSize }. The client copies these
 * onto the document payload as fileUrl, filePublicId, fileBytes, and
 * fileSize.
 */
router.post(
  '/admin/upload/file',
  protect,
  adminOnly,
  upload.single('file'),
  documentsController.uploadDocumentFileHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — reads
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /documents/admin/all
 * Every document, any status.
 *
 * Declared BEFORE /admin/:documentId so "all" isn't parsed as a UUID.
 */
router.get(
  '/admin/all',
  protect,
  adminOnly,
  documentsController.listAllDocumentsHandler,
);

/**
 * GET /documents/admin/pending
 * Documents waiting on review.
 *
 * Declared BEFORE /admin/:documentId so "pending" isn't parsed as a
 * UUID.
 */
router.get(
  '/admin/pending',
  protect,
  adminOnly,
  documentsController.listPendingDocumentsHandler,
);

/**
 * GET /documents/admin/:documentId
 * One document, any status, including audit fields.
 */
router.get(
  '/admin/:documentId',
  protect,
  adminOnly,
  validate(documentIdParamSchema),
  documentsController.getDocumentHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — writes
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /documents/admin
 * Create a new draft document.
 *
 * Body: { payload: DocumentInput }
 */
router.post(
  '/admin',
  protect,
  adminOnly,
  validate(createDocumentSchema),
  documentsController.createDocumentHandler,
);

/**
 * PATCH /documents/admin/:documentId
 * Update a document the caller owns. Drafts and rejected only.
 *
 * Body: { payload: Partial<DocumentInput> }
 */
router.patch(
  '/admin/:documentId',
  protect,
  adminOnly,
  validate(documentIdParamSchema),
  validate(updateDocumentSchema),
  documentsController.updateDocumentHandler,
);

/**
 * POST /documents/admin/:documentId/submit
 * Draft or rejected → pending.
 */
router.post(
  '/admin/:documentId/submit',
  protect,
  adminOnly,
  validate(documentIdParamSchema),
  validate(submitDocumentSchema),
  documentsController.submitDocumentHandler,
);

/**
 * DELETE /documents/admin/:documentId
 * Delete the caller's own draft or rejected document.
 *
 * The service destroys the Cloudinary file referenced by the row.
 */
router.delete(
  '/admin/:documentId',
  protect,
  adminOnly,
  validate(documentIdParamSchema),
  documentsController.deleteDocumentHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN — review
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /documents/admin/:documentId/approve
 * Publish a pending document.
 *
 * Body: { reviewNote?: string }
 */
router.post(
  '/admin/:documentId/approve',
  protect,
  superAdminOnly,
  validate(documentIdParamSchema),
  validate(approveDocumentSchema),
  documentsController.approveDocumentHandler,
);

/**
 * POST /documents/admin/:documentId/reject
 * Decline a pending document. A review note is required.
 *
 * Body: { reviewNote: string }
 */
router.post(
  '/admin/:documentId/reject',
  protect,
  superAdminOnly,
  validate(documentIdParamSchema),
  validate(rejectDocumentSchema),
  documentsController.rejectDocumentHandler,
);

export default router;