// src/features/news/news.controller.ts
//
// HTTP layer for the News feature.
//
// Controllers do four things and nothing else:
//   1. Pull validated data off the request (body / params / query / user).
//   2. Call the service.
//   3. Pass the result to `sendResponse`.
//   4. Let `catchAsync` funnel errors to the global error handler.
//
// No business logic. No SQL. No role checks beyond what the middleware
// already enforced — the service re-verifies authorization anyway.

import { Request, Response } from 'express';
import * as newsService from './news.service';
import { catchAsync } from '../../utils/catchasync';
import { sendResponse } from '../../utils/Apiresponse';
import { AppError } from '../../utils/Apperror';
import type { NewsImageUploadResult } from './news.types';

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
 * GET /news
 * Public. List published articles. Paginated, searchable.
 *
 * Query: { search?, featured?, page?, limit? }
 */
export const listPublishedNewsHandler = catchAsync(
  async (req: Request, res: Response) => {
    // `validate.middleware.ts` stores parsed query on req.validatedQuery.
    // Fall back to req.query for safety if the middleware wasn't mounted.
    const parsed = (req as any).validatedQuery ?? req.query;
    const result = await newsService.listPublishedNews(parsed);
    sendResponse(res, 200, result);
  },
);

/**
 * GET /news/:newsId
 * Public. Returns a single published article, or 404.
 */
export const getPublishedNewsHandler = catchAsync(
  async (req: Request, res: Response) => {
    const newsId = param(req, 'newsId');
    const article = await newsService.getPublishedNewsById(newsId);
    sendResponse(res, 200, article);
  },
);

// ─── Admin — reads ───────────────────────────────────────────────────────────

/**
 * GET /news/admin/all
 * Admin. Every article regardless of status, newest first.
 */
export const listAllNewsHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const articles = await newsService.listAllNews();
    sendResponse(res, 200, articles);
  },
);

/**
 * GET /news/admin/pending
 * Admin. Articles waiting on review.
 */
export const listPendingNewsHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const articles = await newsService.listPendingNews();
    sendResponse(res, 200, articles);
  },
);

/**
 * GET /news/admin/:newsId
 * Admin. Full article, any status, including audit fields.
 */
export const getNewsHandler = catchAsync(
  async (req: Request, res: Response) => {
    const newsId = param(req, 'newsId');
    const article = await newsService.getNewsById(newsId);
    sendResponse(res, 200, article);
  },
);

// ─── Admin — writes ──────────────────────────────────────────────────────────

/**
 * POST /news/admin
 * Admin. Creates a new draft article.
 *
 * Body: { payload: NewsInput }
 */
export const createNewsHandler = catchAsync(
  async (req: Request, res: Response) => {
    const { payload } = req.body;
    const article = await newsService.createNews(
      req.user!.id,
      req.user!.role,
      payload,
    );
    sendResponse(res, 201, article, 'Article created.');
  },
);

/**
 * PATCH /news/admin/:newsId
 * Admin. Updates an article the caller owns. Only drafts and rejected
 * articles can be edited.
 *
 * Body: { payload: Partial<NewsInput> }
 */
export const updateNewsHandler = catchAsync(
  async (req: Request, res: Response) => {
    const newsId = param(req, 'newsId');
    const { payload } = req.body;
    const article = await newsService.updateNews(
      req.user!.id,
      newsId,
      payload,
    );
    sendResponse(res, 200, article, 'Article updated.');
  },
);

/**
 * POST /news/admin/:newsId/submit
 * Admin. Moves a draft or rejected article to pending.
 */
export const submitNewsHandler = catchAsync(
  async (req: Request, res: Response) => {
    const newsId = param(req, 'newsId');
    const article = await newsService.submitNews(req.user!.id, newsId);
    sendResponse(res, 200, article, 'Article submitted for review.');
  },
);

/**
 * DELETE /news/admin/:newsId
 * Admin. Deletes the caller's own draft or rejected article.
 *
 * The service destroys the Cloudinary asset referenced by the row.
 */
export const deleteNewsHandler = catchAsync(
  async (req: Request, res: Response) => {
    const newsId = param(req, 'newsId');
    await newsService.deleteNews(req.user!.id, newsId);
    sendResponse(res, 200, null, 'Article deleted.');
  },
);

// ─── Super admin — review ────────────────────────────────────────────────────

/**
 * POST /news/admin/:newsId/approve
 * Super admin. Publishes a pending article.
 *
 * Body: { reviewNote?: string }
 */
export const approveNewsHandler = catchAsync(
  async (req: Request, res: Response) => {
    const newsId = param(req, 'newsId');
    const { reviewNote } = req.body;
    const article = await newsService.approveNews(
      req.user!.id,
      req.user!.role,
      newsId,
      reviewNote,
    );
    sendResponse(res, 200, article, 'Article published.');
  },
);

/**
 * POST /news/admin/:newsId/reject
 * Super admin. Declines a pending article without publishing.
 *
 * Body: { reviewNote: string }
 */
export const rejectNewsHandler = catchAsync(
  async (req: Request, res: Response) => {
    const newsId = param(req, 'newsId');
    const { reviewNote } = req.body;
    const article = await newsService.rejectNews(
      req.user!.id,
      req.user!.role,
      newsId,
      reviewNote,
    );
    sendResponse(res, 200, article, 'Article rejected.');
  },
);

/**
 * POST /news/admin/:newsId/feature
 * Super admin. Sets or clears the featured flag on a published article.
 * Enforces "at most one featured published article" in the service.
 *
 * Body: { isFeatured: boolean }
 */
export const setFeaturedNewsHandler = catchAsync(
  async (req: Request, res: Response) => {
    const newsId = param(req, 'newsId');
    const { isFeatured } = req.body;
    const article = await newsService.setFeaturedNews(
      req.user!.id,
      req.user!.role,
      newsId,
      Boolean(isFeatured),
    );
    sendResponse(
      res,
      200,
      article,
      isFeatured ? 'Article featured.' : 'Article unfeatured.',
    );
  },
);

// ─── Admin — upload ──────────────────────────────────────────────────────────

/**
 * POST /news/admin/upload/image
 * Admin. Multipart upload of a single image.
 *
 * Body: multipart/form-data with a file in the "image" field.
 *
 * Returns `NewsImageUploadResult`:
 *     { url: string, publicId: string }
 *
 * The client copies these onto the article payload as
 * `{ imageUrl: url, imagePublicId: publicId }` before saving.
 *
 * No `validate` middleware on this route — the body is multipart, not
 * JSON. Multer's `fileFilter` handles the MIME check before the handler.
 */
export const uploadNewsImageHandler = catchAsync(
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError(
        'No file uploaded. Send a file under the "image" field.',
        400,
      );
    }

    // Imported lazily to keep the controller file focused on HTTP.
    const { uploadBuffer } = await import('../../utils/upload');

    const result = await uploadBuffer(
      req.file.buffer,
      { folder: 'news/images', tags: ['news'] },
      req.file.mimetype,
    );

    const payload: NewsImageUploadResult = {
      url: result.url,
      publicId: result.publicId,
    };

    sendResponse(res, 200, payload, 'Image uploaded.');
  },
);