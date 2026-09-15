// src/features/judges/judges.routes.ts
//
// Route wiring for the Judges feature.
//
// Path layout:
//   /judges                 → public reads
//   /judges/:judgeId        → public read one
//   /judges/admin/*         → admin reads and writes
//
// Upload routes:
//   POST   /judges/admin            → multipart (text fields + optional image)
//   PATCH  /judges/admin/:judgeId   → multipart (text fields + optional image)
//
// With multipart, multer parses the request stream and populates
// `req.body` (as strings) and `req.file` (as a buffer). This means
// multer MUST run before `validate`. If the validator runs first,
// `req.body.payload` is still undefined and every multipart request
// fails with "payload is required". Order per write route is:
//
//   protect → adminOnly → upload.single('image') → validate → handler
//
// There is currently no route for clearing a portrait without
// replacing it. The service supports it (`updateJudge(..., null)`);
// when you want it, add `DELETE /judges/admin/:judgeId/image` with a
// dedicated controller handler that calls the service with
// `payload = {}` and `image = null`.
//
// Splitting admin routes under `/admin` avoids the collision between
// `/judges/:judgeId` and `/judges/admin/all` — without the prefix,
// `admin` would be parsed as a judgeId.
//
// Declaration order matters. Express matches routes top-to-bottom, so
// any static segment that could also match a `:judgeId` param must be
// declared first:
//   /admin/all      before  /admin/:judgeId
//   /admin/pending  before  /admin/:judgeId
//
// Middleware order per route, left to right:
//   1. protect       — populates req.user from the access token
//   2. role gate     — adminOnly or superAdminOnly
//   3. upload        — (write routes only) parses multipart into req.body/req.file
//   4. validate      — Zod body/param/query validation
//   5. handler       — the controller
//
// Public routes skip 1–4. The service re-checks roles anyway, so the
// middleware is the first line of defense, not the only one.

import { Router } from 'express';
import * as judgesController from './judges.controller';
import {
  protect,
  adminOnly,
  superAdminOnly,
} from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { upload } from '../../middleware/upload.middleware';
import {
  createJudgeSchema,
  updateJudgeSchema,
  submitJudgeSchema,
  approveJudgeSchema,
  rejectJudgeSchema,
  judgeIdParamSchema,
  listJudgesQuerySchema,
} from './judges.validator';

const router = Router();

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /judges
 * List published judge records. Paginated, searchable, filterable by
 * region.
 */
router.get(
  '/',
  validate(listJudgesQuerySchema),
  judgesController.listPublishedJudgesHandler,
);

/**
 * GET /judges/:judgeId
 * One published judge record. 404 for drafts, pending, and rejected.
 */
router.get(
  '/:judgeId',
  validate(judgeIdParamSchema),
  judgesController.getPublishedJudgeHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — reads
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /judges/admin/all
 * Every judge record, any status.
 *
 * Declared BEFORE /admin/:judgeId so "all" isn't parsed as a UUID.
 */
router.get(
  '/admin/all',
  protect,
  adminOnly,
  judgesController.listAllJudgesHandler,
);

/**
 * GET /judges/admin/pending
 * Judge records waiting on review.
 *
 * Declared BEFORE /admin/:judgeId so "pending" isn't parsed as a UUID.
 */
router.get(
  '/admin/pending',
  protect,
  adminOnly,
  judgesController.listPendingJudgesHandler,
);

/**
 * GET /judges/admin/:judgeId
 * One judge record, any status, including audit fields.
 */
router.get(
  '/admin/:judgeId',
  protect,
  adminOnly,
  validate(judgeIdParamSchema),
  judgesController.getJudgeHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — writes
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /judges/admin
 * Create a new draft judge record.
 *
 * Content-Type: multipart/form-data
 *   - `payload` field: JSON string of JudgeInput.
 *   - `image` field (optional): the portrait file.
 *
 * Also accepts application/json with `payload` as an object, in which
 * case no image is attached and `upload.single` is a no-op. The
 * controller's `extractPayload` helper handles both shapes.
 *
 * Order: protect → adminOnly → upload → validate → handler.
 * Multer MUST precede validate; see header.
 */
router.post(
  '/admin',
  protect,
  adminOnly,
  upload.single('image'),
  validate(createJudgeSchema),
  judgesController.createJudgeHandler,
);

/**
 * PATCH /judges/admin/:judgeId
 * Update a judge record the caller owns. Drafts and rejected only.
 *
 * Content-Type: multipart/form-data
 *   - `payload` field: JSON string of Partial<JudgeInput>.
 *   - `image` field (optional): replacement portrait. Absence means
 *     "leave the existing portrait alone".
 *
 * Order: protect → adminOnly → upload → validate(params) →
 *        validate(body) → handler.
 * Multer MUST precede both validators; see header.
 */
router.patch(
  '/admin/:judgeId',
  protect,
  adminOnly,
  upload.single('image'),
  validate(judgeIdParamSchema),
  validate(updateJudgeSchema),
  judgesController.updateJudgeHandler,
);

/**
 * POST /judges/admin/:judgeId/submit
 * Draft or rejected → pending.
 *
 * No file: submission doesn't touch the portrait.
 */
router.post(
  '/admin/:judgeId/submit',
  protect,
  adminOnly,
  validate(judgeIdParamSchema),
  validate(submitJudgeSchema),
  judgesController.submitJudgeHandler,
);

/**
 * DELETE /judges/admin/:judgeId
 * Delete the caller's own draft or rejected judge record.
 *
 * No file: the service deletes the portrait from Cloudinary after the
 * DB row is removed.
 */
router.delete(
  '/admin/:judgeId',
  protect,
  adminOnly,
  validate(judgeIdParamSchema),
  judgesController.deleteJudgeHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN — review
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /judges/admin/:judgeId/approve
 * Publish a pending judge record.
 *
 * Body: { reviewNote?: string }
 */
router.post(
  '/admin/:judgeId/approve',
  protect,
  superAdminOnly,
  validate(judgeIdParamSchema),
  validate(approveJudgeSchema),
  judgesController.approveJudgeHandler,
);

/**
 * POST /judges/admin/:judgeId/reject
 * Decline a pending judge record. A review note is required.
 *
 * Body: { reviewNote: string }
 */
router.post(
  '/admin/:judgeId/reject',
  protect,
  superAdminOnly,
  validate(judgeIdParamSchema),
  validate(rejectJudgeSchema),
  judgesController.rejectJudgeHandler,
);

export default router;