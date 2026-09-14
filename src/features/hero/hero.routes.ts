// src/features/hero/hero.routes.ts
//
// Route wiring for the Hero feature.
//
// Middleware order per route, left to right:
//   1. authenticate  — populates req.user from the access token
//   2. role gate     — adminOnly or superAdminOnly
//   3. validate      — Zod body/param validation (skipped on multipart)
//   4. handler       — the controller
//
// Public routes skip 1–3. The service re-checks roles anyway, so the
// middleware is the first line of defense, not the only one.

import { Router } from 'express';
import * as heroController from './hero.controller';
import { protect, adminOnly, superAdminOnly } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { upload } from '../../middleware/upload.middleware';
import {
  saveHeroDraftSchema,
  approveHeroVersionSchema,
  rejectHeroVersionSchema,
  heroVersionIdParamSchema,
} from './hero.validator';

const router = Router();

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /hero
 * The live Hero. Frontend hits this on page load.
 */
router.get('/', heroController.getLiveHeroHandler);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — uploads
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /hero/upload/slide-image
 * Multipart upload of a single slide image.
 * Form field: "image"
 * Returns: { url, publicId }
 *
 * No `validate` middleware — the body is multipart, not JSON. Multer's
 * `fileFilter` handles the MIME check before the handler runs.
 */
router.post(
  '/upload/slide-image',
  protect,
  adminOnly,
  upload.single('image'),
  heroController.uploadSlideImageHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — drafts, submission, history
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /hero/draft
 * The caller's open draft, or null.
 */
router.get(
  '/draft',
  protect,
  adminOnly,
  heroController.getMyDraftHandler,
);

/**
 * POST /hero/draft
 * Create a new draft, or update an existing one (pass `versionId` in body).
 */
router.post(
  '/draft',
  protect,
  adminOnly,
  validate(saveHeroDraftSchema),
  heroController.saveDraftHandler,
);

/**
 * POST /hero/draft/:versionId/submit
 * Flip a draft from `draft` to `pending`.
 */
router.post(
  '/draft/:versionId/submit',
  protect,
  adminOnly,
  validate(heroVersionIdParamSchema),
  heroController.submitDraftHandler,
);

/**
 * DELETE /hero/draft/:versionId
 * Delete the caller's own draft.
 */
router.delete(
  '/draft/:versionId',
  protect,
  adminOnly,
  validate(heroVersionIdParamSchema),
  heroController.deleteDraftHandler,
);

/**
 * GET /hero/versions
 * Every version, newest first.
 */
router.get(
  '/versions',
  protect,
  adminOnly,
  heroController.listVersionsHandler,
);

/**
 * GET /hero/versions/pending
 * Versions waiting on review.
 */
router.get(
  '/versions/pending',
  protect,
  adminOnly,
  heroController.listPendingVersionsHandler,
);

/**
 * GET /hero/versions/:versionId
 * One version, full payload included.
 */
router.get(
  '/versions/:versionId',
  protect,
  adminOnly,
  validate(heroVersionIdParamSchema),
  heroController.getVersionHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN — review
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /hero/versions/:versionId/approve
 * Promote a pending version to live.
 *
 * Body: { reviewNote?: string }
 */
router.post(
  '/versions/:versionId/approve',
  protect,
  superAdminOnly,
  validate(heroVersionIdParamSchema),
  validate(approveHeroVersionSchema),
  heroController.approveVersionHandler,
);

/**
 * POST /hero/versions/:versionId/reject
 * Decline a pending version.
 *
 * Body: { reviewNote: string }
 */
router.post(
  '/versions/:versionId/reject',
  protect,
  superAdminOnly,
  validate(heroVersionIdParamSchema),
  validate(rejectHeroVersionSchema),
  heroController.rejectVersionHandler,
);

/**
 * POST /hero/versions/:versionId/rollback
 * Re-promote a previously approved version as a fresh approved version.
 */
router.post(
  '/versions/:versionId/rollback',
  protect,
  superAdminOnly,
  validate(heroVersionIdParamSchema),
  heroController.rollbackVersionHandler,
);

export default router;