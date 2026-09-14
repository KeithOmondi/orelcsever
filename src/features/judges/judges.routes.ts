// src/features/judges/judges.routes.ts
//
// Route wiring for the Judges feature.
//
// Path layout:
//   /judges                 → public reads
//   /judges/:judgeId        → public read one
//   /judges/admin/*         → admin reads and writes
//
// No upload route — judge portraits are external URLs, not uploads.
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
//   3. validate      — Zod body/param/query validation
//   4. handler       — the controller
//
// Public routes skip 1–3. The service re-checks roles anyway, so the
// middleware is the first line of defense, not the only one.

import { Router } from 'express';
import * as judgesController from './judges.controller';
import {
  protect,
  adminOnly,
  superAdminOnly,
} from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
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
 * Body: { payload: JudgeInput }
 */
router.post(
  '/admin',
  protect,
  adminOnly,
  validate(createJudgeSchema),
  judgesController.createJudgeHandler,
);

/**
 * PATCH /judges/admin/:judgeId
 * Update a judge record the caller owns. Drafts and rejected only.
 *
 * Body: { payload: Partial<JudgeInput> }
 */
router.patch(
  '/admin/:judgeId',
  protect,
  adminOnly,
  validate(judgeIdParamSchema),
  validate(updateJudgeSchema),
  judgesController.updateJudgeHandler,
);

/**
 * POST /judges/admin/:judgeId/submit
 * Draft or rejected → pending.
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