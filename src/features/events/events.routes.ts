// src/features/events/events.routes.ts
//
// Route wiring for the Events feature.
//
// Path layout:
//   /events                        → public reads
//   /events/:eventId               → public read one
//   /events/admin/*                → admin reads and writes
//   /events/admin/upload/image     → admin image upload (multipart)
//
// Splitting admin routes under `/admin` avoids the collision between
// `/events/:eventId` and `/events/admin/all` — without the prefix,
// `admin` would be parsed as an eventId.
//
// Declaration order matters. Express matches routes top-to-bottom, so
// any static segment that could also match a `:eventId` param must be
// declared first:
//   /admin/upload/image  before  /admin/:eventId
//   /admin/all           before  /admin/:eventId
//   /admin/pending       before  /admin/:eventId
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
import * as eventsController from './events.controller';
import {
  protect,
  adminOnly,
  superAdminOnly,
} from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { upload } from '../../middleware/upload.middleware';
import {
  createEventSchema,
  updateEventSchema,
  submitEventSchema,
  approveEventSchema,
  rejectEventSchema,
  setFeaturedSchema,
  eventIdParamSchema,
  listEventsQuerySchema,
} from './events.validator';

const router = Router();

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /events
 * List published events. Paginated, searchable, category-filterable.
 */
router.get(
  '/',
  validate(listEventsQuerySchema),
  eventsController.listPublishedEventsHandler,
);

/**
 * GET /events/:eventId
 * One published event. 404 for drafts, pending, and rejected.
 */
router.get(
  '/:eventId',
  validate(eventIdParamSchema),
  eventsController.getPublishedEventHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — uploads
//
// Declared before /admin/:eventId so the static "upload" segment is
// matched first. The verb (POST) also disambiguates from the PATCH and
// DELETE on /admin/:eventId, but ordering removes any doubt.
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /events/admin/upload/image
 * Multipart image upload for event headers.
 * Form field: "image".
 *
 * No `validate` — multipart, not JSON. Multer's `fileFilter` enforces
 * the MIME allowlist before the handler runs.
 *
 * Returns: { url, publicId }. The client copies these onto the event
 * payload as { imageUrl, imagePublicId } before saving.
 */
router.post(
  '/admin/upload/image',
  protect,
  adminOnly,
  upload.single('image'),
  eventsController.uploadEventImageHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — reads
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /events/admin/all
 * Every event, any status.
 *
 * Declared BEFORE /admin/:eventId so "all" isn't parsed as a UUID.
 */
router.get(
  '/admin/all',
  protect,
  adminOnly,
  eventsController.listAllEventsHandler,
);

/**
 * GET /events/admin/pending
 * Events waiting on review.
 *
 * Declared BEFORE /admin/:eventId so "pending" isn't parsed as a UUID.
 */
router.get(
  '/admin/pending',
  protect,
  adminOnly,
  eventsController.listPendingEventsHandler,
);

/**
 * GET /events/admin/:eventId
 * One event, any status, including audit fields.
 */
router.get(
  '/admin/:eventId',
  protect,
  adminOnly,
  validate(eventIdParamSchema),
  eventsController.getEventHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — writes
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /events/admin
 * Create a new draft event.
 *
 * Body: { payload: EventInput }
 */
router.post(
  '/admin',
  protect,
  adminOnly,
  validate(createEventSchema),
  eventsController.createEventHandler,
);

/**
 * PATCH /events/admin/:eventId
 * Update an event the caller owns. Drafts and rejected only.
 *
 * Body: { payload: Partial<EventInput> }
 */
router.patch(
  '/admin/:eventId',
  protect,
  adminOnly,
  validate(eventIdParamSchema),
  validate(updateEventSchema),
  eventsController.updateEventHandler,
);

/**
 * POST /events/admin/:eventId/submit
 * Draft or rejected → pending.
 */
router.post(
  '/admin/:eventId/submit',
  protect,
  adminOnly,
  validate(eventIdParamSchema),
  validate(submitEventSchema),
  eventsController.submitEventHandler,
);

/**
 * DELETE /events/admin/:eventId
 * Delete the caller's own draft or rejected event.
 *
 * The service destroys the Cloudinary asset referenced by the row.
 */
router.delete(
  '/admin/:eventId',
  protect,
  adminOnly,
  validate(eventIdParamSchema),
  eventsController.deleteEventHandler,
);

// ════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN — review
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /events/admin/:eventId/approve
 * Publish a pending event.
 *
 * Body: { reviewNote?: string }
 */
router.post(
  '/admin/:eventId/approve',
  protect,
  superAdminOnly,
  validate(eventIdParamSchema),
  validate(approveEventSchema),
  eventsController.approveEventHandler,
);

/**
 * POST /events/admin/:eventId/reject
 * Decline a pending event. A review note is required.
 *
 * Body: { reviewNote: string }
 */
router.post(
  '/admin/:eventId/reject',
  protect,
  superAdminOnly,
  validate(eventIdParamSchema),
  validate(rejectEventSchema),
  eventsController.rejectEventHandler,
);

/**
 * POST /events/admin/:eventId/feature
 * Set or clear the featured flag on a published event.
 * The service enforces "at most one featured published event".
 *
 * Body: { isFeatured: boolean }
 */
router.post(
  '/admin/:eventId/feature',
  protect,
  superAdminOnly,
  validate(eventIdParamSchema),
  validate(setFeaturedSchema),
  eventsController.setFeaturedEventHandler,
);

export default router;