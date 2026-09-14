// src/features/hero/hero.controller.ts
//
// HTTP layer for the Hero feature.

import { Request, Response } from 'express';
import * as heroService from './hero.service';
import { catchAsync } from '../../utils/catchasync';
import { sendResponse } from '../../utils/Apiresponse';
import { AppError } from '../../utils/Apperror';
import { uploadBuffer } from '../../utils/upload';

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
 * GET /hero
 * Public. Returns the currently live Hero.
 */
export const getLiveHeroHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const hero = await heroService.getLiveHero();
    sendResponse(res, 200, hero);
  },
);

// ─── Admin — uploads ─────────────────────────────────────────────────────────

/**
 * POST /hero/upload/slide-image
 * Admin. Multipart upload of a single image.
 *
 * Body: multipart/form-data with a file in the "image" field.
 * Returns: { url, publicId } — store both on the slide's draft entry.
 *
 * The controller does not touch the draft row. It returns the asset
 * coordinates; the client puts them into the next POST /hero/draft call.
 * That keeps the draft payload as the single source of truth for what
 * is actually being proposed.
 */
export const uploadSlideImageHandler = catchAsync(
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError(
        'No file uploaded. Send a file under the "image" field.',
        400,
      );
    }

    const result = await uploadBuffer(
      req.file.buffer,
      { folder: 'hero/slides', tags: ['hero', 'slide'] },
      req.file.mimetype,
    );

    sendResponse(
      res,
      200,
      { url: result.url, publicId: result.publicId },
      'Image uploaded.',
    );
  },
);

// ─── Admin — drafts & submission ─────────────────────────────────────────────

/**
 * GET /hero/draft
 * Admin. Returns the caller's open draft, or null.
 */
export const getMyDraftHandler = catchAsync(
  async (req: Request, res: Response) => {
    const draft = await heroService.getMyDraft(req.user!.id);
    sendResponse(res, 200, draft);
  },
);

/**
 * POST /hero/draft
 * Admin. Creates a new draft, or updates an existing one if `versionId`
 * is present in the body.
 *
 * Body: { versionId?: string, payload: HeroVersionPayload }
 */
export const saveDraftHandler = catchAsync(
  async (req: Request, res: Response) => {
    const { versionId, payload } = req.body;
    const version = await heroService.saveDraft(
      req.user!.id,
      req.user!.role,
      payload,
      versionId,
    );
    sendResponse(res, 200, version, 'Draft saved.');
  },
);

/**
 * POST /hero/draft/:versionId/submit
 * Admin. Moves the caller's draft to `pending`.
 */
export const submitDraftHandler = catchAsync(
  async (req: Request, res: Response) => {
    const versionId = param(req, 'versionId');
    const version = await heroService.submitDraft(req.user!.id, versionId);
    sendResponse(res, 200, version, 'Draft submitted for review.');
  },
);

/**
 * DELETE /hero/draft/:versionId
 * Admin. Deletes the caller's own draft.
 */
export const deleteDraftHandler = catchAsync(
  async (req: Request, res: Response) => {
    const versionId = param(req, 'versionId');
    await heroService.deleteDraft(req.user!.id, versionId);
    sendResponse(res, 200, null, 'Draft deleted.');
  },
);

// ─── Admin — history ─────────────────────────────────────────────────────────

/**
 * GET /hero/versions
 * Admin. All versions, newest first.
 */
export const listVersionsHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const versions = await heroService.listVersions();
    sendResponse(res, 200, versions);
  },
);

/**
 * GET /hero/versions/pending
 * Admin. Versions awaiting review.
 */
export const listPendingVersionsHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const versions = await heroService.listPendingVersions();
    sendResponse(res, 200, versions);
  },
);

/**
 * GET /hero/versions/:versionId
 * Admin. Full version, including payload.
 */
export const getVersionHandler = catchAsync(
  async (req: Request, res: Response) => {
    const versionId = param(req, 'versionId');
    const version = await heroService.getVersionById(versionId);
    sendResponse(res, 200, version);
  },
);

// ─── Super admin — review ────────────────────────────────────────────────────

/**
 * POST /hero/versions/:versionId/approve
 * Super admin. Promotes the version's payload onto the live tables.
 *
 * Body: { reviewNote?: string }
 */
export const approveVersionHandler = catchAsync(
  async (req: Request, res: Response) => {
    const versionId = param(req, 'versionId');
    const { reviewNote } = req.body;
    const version = await heroService.approveVersion(
      req.user!.id,
      req.user!.role,
      versionId,
      reviewNote,
    );
    sendResponse(res, 200, version, 'Version approved and published.');
  },
);

/**
 * POST /hero/versions/:versionId/reject
 * Super admin. Declines a pending version without touching live data.
 *
 * Body: { reviewNote: string }
 */
export const rejectVersionHandler = catchAsync(
  async (req: Request, res: Response) => {
    const versionId = param(req, 'versionId');
    const { reviewNote } = req.body;
    const version = await heroService.rejectVersion(
      req.user!.id,
      req.user!.role,
      versionId,
      reviewNote,
    );
    sendResponse(res, 200, version, 'Version rejected.');
  },
);

/**
 * POST /hero/versions/:versionId/rollback
 * Super admin. Re-promotes a previously approved version by creating a
 * new approved version that carries its payload.
 */
export const rollbackVersionHandler = catchAsync(
  async (req: Request, res: Response) => {
    const versionId = param(req, 'versionId');
    const version = await heroService.rollbackToVersion(
      req.user!.id,
      req.user!.role,
      versionId,
    );
    sendResponse(res, 200, version, 'Rolled back successfully.');
  },
);