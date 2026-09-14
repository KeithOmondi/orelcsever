// src/features/news/news.routes.ts
//
// Route wiring for the News feature.
//
// Path layout:
//   /news                        → public reads
//   /news/:newsId                → public read one
//   /news/admin/*                → admin reads and writes
//   /news/admin/upload/image     → admin image upload (multipart)
//
// Splitting admin routes under `/admin` avoids the collision between
// `/news/:newsId` and `/news/admin/all` — without the prefix, `admin`
// would be parsed as a newsId.
//
// Declaration order matters. Express matches routes top-to-bottom, so
// any static segment that could also match a `:newsId` param must be
// declared first:
//   /admin/upload/image  before  /admin/:newsId
//   /admin/all           before  /admin/:newsId
//   /admin/pending       before  /admin/:newsId
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
import * as newsController from './news.controller';
import {
  protect,
  adminOnly,
  superAdminOnly,
} from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { upload } from '../../middleware/upload.middleware';
import {
  createNewsSchema,
  updateNewsSchema,
  submitNewsSchema,
  approveNewsSchema,
  rejectNewsSchema,
  newsIdParamSchema,
  listNewsQuerySchema,
} from './news.validator';

const router = Router();

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /news
 * List published articles. Paginated, searchable.
 */
router.get(
  '/',
  validate(listNewsQuerySchema),
  newsController.listPublishedNewsHandler,
);

/**
 * GET /news/:newsId
 * One published article. 404 for drafts, pending, and rejected.
 */
router.get(
  '/:newsId',
  validate(newsIdParamSchema),
  newsController.getPublishedNewsHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — uploads
//
// Declared before /admin/:newsId so the static "upload" segment is
// matched first. The verb (POST) also disambiguates from the PATCH and
// DELETE on /admin/:newsId, but ordering removes any doubt.
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /news/admin/upload/image
 * Multipart image upload for article headers.
 * Form field: "image".
 *
 * No `validate` — multipart, not JSON. Multer's `fileFilter` enforces
 * the MIME allowlist before the handler runs.
 *
 * Returns: { url, publicId }. The client copies these onto the article
 * payload as { imageUrl, imagePublicId } before saving.
 */
router.post(
  '/admin/upload/image',
  protect,
  adminOnly,
  upload.single('image'),
  newsController.uploadNewsImageHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — reads
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /news/admin/all
 * Every article, any status.
 *
 * Declared BEFORE /admin/:newsId so "all" isn't parsed as a UUID.
 */
router.get(
  '/admin/all',
  protect,
  adminOnly,
  newsController.listAllNewsHandler,
);

/**
 * GET /news/admin/pending
 * Articles waiting on review.
 *
 * Declared BEFORE /admin/:newsId so "pending" isn't parsed as a UUID.
 */
router.get(
  '/admin/pending',
  protect,
  adminOnly,
  newsController.listPendingNewsHandler,
);

/**
 * GET /news/admin/:newsId
 * One article, any status, including audit fields.
 */
router.get(
  '/admin/:newsId',
  protect,
  adminOnly,
  validate(newsIdParamSchema),
  newsController.getNewsHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — writes
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /news/admin
 * Create a new draft article.
 *
 * Body: { payload: NewsInput }
 */
router.post(
  '/admin',
  protect,
  adminOnly,
  validate(createNewsSchema),
  newsController.createNewsHandler,
);

/**
 * PATCH /news/admin/:newsId
 * Update an article the caller owns. Drafts and rejected only.
 *
 * Body: { payload: Partial<NewsInput> }
 */
router.patch(
  '/admin/:newsId',
  protect,
  adminOnly,
  validate(newsIdParamSchema),
  validate(updateNewsSchema),
  newsController.updateNewsHandler,
);

/**
 * POST /news/admin/:newsId/submit
 * Draft or rejected → pending.
 */
router.post(
  '/admin/:newsId/submit',
  protect,
  adminOnly,
  validate(newsIdParamSchema),
  validate(submitNewsSchema),
  newsController.submitNewsHandler,
);

/**
 * DELETE /news/admin/:newsId
 * Delete the caller's own draft or rejected article.
 *
 * The service destroys the Cloudinary asset referenced by the row.
 */
router.delete(
  '/admin/:newsId',
  protect,
  adminOnly,
  validate(newsIdParamSchema),
  newsController.deleteNewsHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN — review
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /news/admin/:newsId/approve
 * Publish a pending article.
 *
 * Body: { reviewNote?: string }
 */
router.post(
  '/admin/:newsId/approve',
  protect,
  superAdminOnly,
  validate(newsIdParamSchema),
  validate(approveNewsSchema),
  newsController.approveNewsHandler,
);

/**
 * POST /news/admin/:newsId/reject
 * Decline a pending article. A review note is required.
 *
 * Body: { reviewNote: string }
 */
router.post(
  '/admin/:newsId/reject',
  protect,
  superAdminOnly,
  validate(newsIdParamSchema),
  validate(rejectNewsSchema),
  newsController.rejectNewsHandler,
);

/**
 * POST /news/admin/:newsId/feature
 * Set or clear the featured flag on a published article.
 * The service enforces "at most one featured published article".
 *
 * Body: { isFeatured: boolean }
 */
router.post(
  '/admin/:newsId/feature',
  protect,
  superAdminOnly,
  validate(newsIdParamSchema),
  //validate(setFeaturedSchema),
  newsController.setFeaturedNewsHandler,
);

export default router;