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
//   protect → adminOnly → upload.single('image') → parseMultipartPayload → validate → handler
//
// `parseMultipartPayload` converts the JSON string in `req.body.payload`
// into an object so the schema validation sees an object, not a string.
// Without it, the create/update schemas fail with
// "Invalid input: expected object, received string".
//
// Routes that accept no body (submit, approve with optional note,
// reject with required note) skip `upload` and may skip `validate`
// entirely when their schema has nothing to check. `submit` is the
// only such route today — see the note on that route for why it no
// longer carries a body validator.
//
// Authorization model:
//   Every write route under /admin uses `adminOnly`, which accepts
//   both `admin` and `super_admin`. Only `approve` and `reject` use
//   `superAdminOnly` — those two actions are the sole operations a
//   regular admin cannot perform.
//
//   Ownership and status restrictions are NOT enforced here. They
//   live in the service (judges.service.ts):
//     - Regular admins: own drafts / rejected records only.
//     - Super admins:   any record, any status.
//   The route-level role gate is the first line; the service is the
//   second and final one.
//
// There is currently no route for clearing a portrait without
// replacing it. The service supports it (`updateJudge(..., null)`).
// When you want it, add:
//
//   DELETE /judges/admin/:judgeId/image
//
// with a handler that calls:
//   judgesService.updateJudge(req.user!.id, req.user!.role, judgeId, {}, null)
// and returns the updated record. Nothing in the service or the
// database needs to change — this is purely an HTTP surface addition.
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
//   1. protect               — populates req.user from the access token
//   2. role gate             — adminOnly or superAdminOnly
//   3. upload                — (write routes only) parses multipart into req.body/req.file
//   4. parseMultipartPayload — (write routes only) JSON.parses req.body.payload
//   5. validate              — Zod body/param/query validation
//   6. handler               — the controller
//
// Public routes skip 1–5. The service re-checks roles anyway, so the
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
  approveJudgeSchema,
  rejectJudgeSchema,
  judgeIdParamSchema,
  listJudgesQuerySchema,
} from './judges.validator';
import { parseMultipartPayload } from '../../middleware/parsePayload.middleware';

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
 * Admin or super admin. Every judge record, any status.
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
 * Admin or super admin. Judge records waiting on review.
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
 * Admin or super admin. One judge record, any status, including
 * audit fields.
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
 * Admin or super admin. Create a new draft judge record.
 *
 * Content-Type: multipart/form-data
 *   - `payload` field: JSON string of JudgeInput.
 *   - `image` field (optional): the portrait file.
 *
 * Also accepts application/json with `payload` as an object, in which
 * case no image is attached and `upload.single` is a no-op. The
 * controller's `extractPayload` helper handles both shapes.
 *
 * Order: protect → adminOnly → upload → parseMultipartPayload →
 *        validate → handler.
 * Multer MUST precede validate; see header.
 */
router.post(
  '/admin',
  protect,
  adminOnly,
  upload.single('image'),
  parseMultipartPayload,
  validate(createJudgeSchema),
  judgesController.createJudgeHandler,
);

/**
 * PATCH /judges/admin/:judgeId
 * Admin or super admin. Update a judge record.
 *
 * Authorization is decided by the service, not this route:
 *   - Regular admins may only edit their own draft / rejected records.
 *   - Super admins may edit any record, any status.
 * Both roles send the same payload shape.
 *
 * Content-Type: multipart/form-data
 *   - `payload` field: JSON string of Partial<JudgeInput>.
 *   - `image` field (optional): replacement portrait. Absence means
 *     "leave the existing portrait alone".
 *
 * Order: protect → adminOnly → upload → parseMultipartPayload →
 *        validate(params) → validate(body) → handler.
 * Multer MUST precede both validators; see header.
 */
router.patch(
  '/admin/:judgeId',
  protect,
  adminOnly,
  upload.single('image'),
  parseMultipartPayload,
  validate(judgeIdParamSchema),
  validate(updateJudgeSchema),
  judgesController.updateJudgeHandler,
);

/**
 * POST /judges/admin/:judgeId/submit
 * Admin. Draft or rejected → pending. Owner-only, by design.
 *
 * A super admin who needs to move a stuck record forward can edit it
 * and approve it directly; submitting someone else's draft isn't a
 * real workflow. This is the one write action that stays owner-only
 * even for super admins.
 *
 * No body, no file. The route carries only a param validator — the
 * `submitJudgeSchema` is deliberately NOT attached here. The schema
 * exists for symmetry and documentation, but `validate()` logs a
 * second pass for every schema it's given, and there's nothing for it
 * to check. Attaching it cost two log lines per submit for no benefit.
 *
 * Order: protect → adminOnly → validate(params) → handler.
 */
router.post(
  '/admin/:judgeId/submit',
  protect,
  adminOnly,
  validate(judgeIdParamSchema),
  judgesController.submitJudgeHandler,
);

/**
 * DELETE /judges/admin/:judgeId
 * Admin or super admin. Delete a judge record.
 *
 * Authorization is decided by the service:
 *   - Regular admins may only delete their own draft / rejected records.
 *   - Super admins may delete any record, any status.
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
 * Super admin only. Publish a pending judge record.
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
 * Super admin only. Decline a pending judge record. A review note is
 * required.
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