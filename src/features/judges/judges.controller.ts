// src/features/judges/judges.controller.ts
//
// HTTP layer for the Judges feature.
//
// Controllers do four things and nothing else:
//   1. Pull validated data off the request (body / params / query / user).
//   2. Call the service.
//   3. Pass the result to `sendResponse`.
//   4. Let `catchAsync` funnel errors to the global error handler.
//
// No business logic. No SQL. No role checks beyond what the middleware
// already enforced — the service re-verifies authorization anyway.
//
// Image handling:
//   - Routes mount `upload.single('image')` from upload.middleware.ts,
//     so portraits arrive as `req.file.buffer` on POST/PATCH.
//   - The controller uploads that buffer to Cloudinary via
//     `uploadBuffer()` and passes the resulting `ImageAsset | null` to
//     the service. Bytes never reach the service.
//   - On PATCH, absence of a file means "leave the existing portrait
//     alone" — we pass `undefined`, not `null`, to preserve the
//     three-state semantics the service defines.
//   - On POST, absence of a file means "no portrait" — we pass `null`.
//   - With multipart/form-data, non-file fields arrive as strings.
//     `payload` is sent as a JSON string and parsed here. If the
//     request is application/json (no image attached), `payload` is
//     already an object and we use it as-is.

import { Request, Response } from 'express';
import * as judgesService from './judges.service';
import { catchAsync } from '../../utils/catchasync';
import { sendResponse } from '../../utils/Apiresponse';
import { AppError } from '../../utils/Apperror';
import { uploadBuffer } from '../../utils/upload';
import type { ImageAsset } from './judges.types';

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
 * Extract `payload` from the request body regardless of content type.
 *
 *   - application/json: body.payload is an object already.
 *   - multipart/form-data: body.payload is a JSON string; parse it.
 *
 * A malformed JSON string is a client error (400), not a server error.
 */
const extractPayload = (req: Request): unknown => {
  const raw = req.body?.payload;

  if (raw === undefined) {
    throw new AppError('payload is required.', 400);
  }

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      throw new AppError('payload must be valid JSON.', 400);
    }
  }

  return raw;
};

/**
 * Upload `req.file` to Cloudinary, if present.
 *
 * `folder` is 'judges' — the only sub-folder this feature writes to.
 * If you later add per-station or per-record folders, make this a
 * parameter.
 */
const uploadPortraitIfPresent = async (
  req: Request,
): Promise<ImageAsset | null> => {
  const file = req.file;
  if (!file) return null;

  const result = await uploadBuffer(
    file.buffer,
    { folder: 'judges' },
    file.mimetype,
  );

  return { url: result.url, publicId: result.publicId };
};

// ─── Public ──────────────────────────────────────────────────────────────────

/**
 * GET /judges
 * Public. List published judge records. Paginated, searchable,
 * filterable by region.
 *
 * Query: { search?, region?, page?, limit? }
 */
export const listPublishedJudgesHandler = catchAsync(
  async (req: Request, res: Response) => {
    // `validate.middleware.ts` stores parsed query on req.validatedQuery.
    // Fall back to req.query for safety if the middleware wasn't mounted.
    const parsed = (req as any).validatedQuery ?? req.query;
    const result = await judgesService.listPublishedJudges(parsed);
    sendResponse(res, 200, result);
  },
);

/**
 * GET /judges/:judgeId
 * Public. Returns a single published judge record, or 404.
 */
export const getPublishedJudgeHandler = catchAsync(
  async (req: Request, res: Response) => {
    const judgeId = param(req, 'judgeId');
    const judge = await judgesService.getPublishedJudgeById(judgeId);
    sendResponse(res, 200, judge);
  },
);

// ─── Admin — reads ───────────────────────────────────────────────────────────

/**
 * GET /judges/admin/all
 * Admin. Every judge record regardless of status, alphabetical.
 */
export const listAllJudgesHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const judges = await judgesService.listAllJudges();
    sendResponse(res, 200, judges);
  },
);

/**
 * GET /judges/admin/pending
 * Admin. Judge records waiting on review.
 */
export const listPendingJudgesHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const judges = await judgesService.listPendingJudges();
    sendResponse(res, 200, judges);
  },
);

/**
 * GET /judges/admin/:judgeId
 * Admin. Full judge record, any status, including audit fields.
 */
export const getJudgeHandler = catchAsync(
  async (req: Request, res: Response) => {
    const judgeId = param(req, 'judgeId');
    const judge = await judgesService.getJudgeById(judgeId);
    sendResponse(res, 200, judge);
  },
);

// ─── Admin — writes ──────────────────────────────────────────────────────────

/**
 * POST /judges/admin
 * Admin. Creates a new draft judge record.
 *
 * Content types accepted:
 *   - multipart/form-data with a `payload` JSON string field and an
 *     optional `image` file.
 *   - application/json with a `payload` object (no image).
 *
 * Body: { payload: JudgeInput }
 */
export const createJudgeHandler = catchAsync(
  async (req: Request, res: Response) => {
    const payload = extractPayload(req) as Parameters<
      typeof judgesService.createJudge
    >[2];

    const image = await uploadPortraitIfPresent(req);

    const judge = await judgesService.createJudge(
      req.user!.id,
      req.user!.role,
      payload,
      image,
    );
    sendResponse(res, 201, judge, 'Judge record created.');
  },
);

/**
 * PATCH /judges/admin/:judgeId
 * Admin. Updates a judge record the caller owns. Only drafts and
 * rejected records can be edited.
 *
 * Image semantics:
 *   - No file attached        → leave existing portrait alone.
 *   - File attached           → replace portrait (old asset deleted by
 *                               the service after the DB write).
 *
 * There is intentionally no "clear the portrait" path via PATCH. If you
 * need one, add a dedicated endpoint (DELETE .../image) so the intent
 * is explicit and doesn't overload "no file" with two meanings.
 *
 * Body: { payload: Partial<JudgeInput> }
 */
export const updateJudgeHandler = catchAsync(
  async (req: Request, res: Response) => {
    const judgeId = param(req, 'judgeId');
    const payload = extractPayload(req) as Parameters<
      typeof judgesService.updateJudge
    >[2];

    // Distinguish "no file" (undefined → leave alone) from "clear"
    // (null). Only upload if a file is present; otherwise pass
    // `undefined`.
    const image = req.file
      ? await uploadPortraitIfPresent(req)
      : undefined;

    const judge = await judgesService.updateJudge(
      req.user!.id,
      judgeId,
      payload,
      image,
    );
    sendResponse(res, 200, judge, 'Judge record updated.');
  },
);

/**
 * POST /judges/admin/:judgeId/submit
 * Admin. Moves a draft or rejected judge record to pending.
 */
export const submitJudgeHandler = catchAsync(
  async (req: Request, res: Response) => {
    const judgeId = param(req, 'judgeId');
    const judge = await judgesService.submitJudge(req.user!.id, judgeId);
    sendResponse(res, 200, judge, 'Judge record submitted for review.');
  },
);

/**
 * DELETE /judges/admin/:judgeId
 * Admin. Deletes the caller's own draft or rejected judge record.
 *
 * The service deletes the Cloudinary portrait after the DB row is
 * removed, fire-and-forget.
 */
export const deleteJudgeHandler = catchAsync(
  async (req: Request, res: Response) => {
    const judgeId = param(req, 'judgeId');
    await judgesService.deleteJudge(req.user!.id, judgeId);
    sendResponse(res, 200, null, 'Judge record deleted.');
  },
);

// ─── Super admin — review ────────────────────────────────────────────────────

/**
 * POST /judges/admin/:judgeId/approve
 * Super admin. Publishes a pending judge record.
 *
 * Body: { reviewNote?: string }
 */
export const approveJudgeHandler = catchAsync(
  async (req: Request, res: Response) => {
    const judgeId = param(req, 'judgeId');
    const { reviewNote } = req.body;
    const judge = await judgesService.approveJudge(
      req.user!.id,
      req.user!.role,
      judgeId,
      reviewNote,
    );
    sendResponse(res, 200, judge, 'Judge record published.');
  },
);

/**
 * POST /judges/admin/:judgeId/reject
 * Super admin. Declines a pending judge record without publishing.
 *
 * Body: { reviewNote: string }
 */
export const rejectJudgeHandler = catchAsync(
  async (req: Request, res: Response) => {
    const judgeId = param(req, 'judgeId');
    const { reviewNote } = req.body;
    const judge = await judgesService.rejectJudge(
      req.user!.id,
      req.user!.role,
      judgeId,
      reviewNote,
    );
    sendResponse(res, 200, judge, 'Judge record rejected.');
  },
);