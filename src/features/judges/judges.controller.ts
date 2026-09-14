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
// No upload handler: judge portraits are external URLs, not Cloudinary
// uploads. See the note on `imageUrl` in judges.types.ts.

import { Request, Response } from 'express';
import * as judgesService from './judges.service';
import { catchAsync } from '../../utils/catchasync';
import { sendResponse } from '../../utils/Apiresponse';
import { AppError } from '../../utils/Apperror';

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
 * Body: { payload: JudgeInput }
 */
export const createJudgeHandler = catchAsync(
  async (req: Request, res: Response) => {
    const { payload } = req.body;
    const judge = await judgesService.createJudge(
      req.user!.id,
      req.user!.role,
      payload,
    );
    sendResponse(res, 201, judge, 'Judge record created.');
  },
);

/**
 * PATCH /judges/admin/:judgeId
 * Admin. Updates a judge record the caller owns. Only drafts and
 * rejected records can be edited.
 *
 * Body: { payload: Partial<JudgeInput> }
 */
export const updateJudgeHandler = catchAsync(
  async (req: Request, res: Response) => {
    const judgeId = param(req, 'judgeId');
    const { payload } = req.body;
    const judge = await judgesService.updateJudge(
      req.user!.id,
      judgeId,
      payload,
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