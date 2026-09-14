// src/features/events/events.controller.ts
//
// HTTP layer for the Events feature.
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
import * as eventsService from './events.service';
import { catchAsync } from '../../utils/catchasync';
import { sendResponse } from '../../utils/Apiresponse';
import { AppError } from '../../utils/Apperror';
import type { EventImageUploadResult } from './events.types';

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
 * GET /events
 * Public. List published events. Paginated, searchable, filterable
 * by category and featured flag.
 *
 * Query: { search?, category?, featured?, page?, limit? }
 */
export const listPublishedEventsHandler = catchAsync(
  async (req: Request, res: Response) => {
    // `validate.middleware.ts` stores parsed query on req.validatedQuery.
    // Fall back to req.query for safety if the middleware wasn't mounted.
    const parsed = (req as any).validatedQuery ?? req.query;
    const result = await eventsService.listPublishedEvents(parsed);
    sendResponse(res, 200, result);
  },
);

/**
 * GET /events/:eventId
 * Public. Returns a single published event, or 404.
 */
export const getPublishedEventHandler = catchAsync(
  async (req: Request, res: Response) => {
    const eventId = param(req, 'eventId');
    const event = await eventsService.getPublishedEventById(eventId);
    sendResponse(res, 200, event);
  },
);

// ─── Admin — reads ───────────────────────────────────────────────────────────

/**
 * GET /events/admin/all
 * Admin. Every event regardless of status, ordered by start date.
 */
export const listAllEventsHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const events = await eventsService.listAllEvents();
    sendResponse(res, 200, events);
  },
);

/**
 * GET /events/admin/pending
 * Admin. Events waiting on review.
 */
export const listPendingEventsHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const events = await eventsService.listPendingEvents();
    sendResponse(res, 200, events);
  },
);

/**
 * GET /events/admin/:eventId
 * Admin. Full event, any status, including audit fields.
 */
export const getEventHandler = catchAsync(
  async (req: Request, res: Response) => {
    const eventId = param(req, 'eventId');
    const event = await eventsService.getEventById(eventId);
    sendResponse(res, 200, event);
  },
);

// ─── Admin — writes ──────────────────────────────────────────────────────────

/**
 * POST /events/admin
 * Admin. Creates a new draft event.
 *
 * Body: { payload: EventInput }
 */
export const createEventHandler = catchAsync(
  async (req: Request, res: Response) => {
    const { payload } = req.body;
    const event = await eventsService.createEvent(
      req.user!.id,
      req.user!.role,
      payload,
    );
    sendResponse(res, 201, event, 'Event created.');
  },
);

/**
 * PATCH /events/admin/:eventId
 * Admin. Updates an event the caller owns. Only drafts and rejected
 * events can be edited.
 *
 * Body: { payload: Partial<EventInput> }
 */
export const updateEventHandler = catchAsync(
  async (req: Request, res: Response) => {
    const eventId = param(req, 'eventId');
    const { payload } = req.body;
    const event = await eventsService.updateEvent(
      req.user!.id,
      eventId,
      payload,
    );
    sendResponse(res, 200, event, 'Event updated.');
  },
);

/**
 * POST /events/admin/:eventId/submit
 * Admin. Moves a draft or rejected event to pending.
 */
export const submitEventHandler = catchAsync(
  async (req: Request, res: Response) => {
    const eventId = param(req, 'eventId');
    const event = await eventsService.submitEvent(req.user!.id, eventId);
    sendResponse(res, 200, event, 'Event submitted for review.');
  },
);

/**
 * DELETE /events/admin/:eventId
 * Admin. Deletes the caller's own draft or rejected event.
 *
 * The service destroys the Cloudinary asset referenced by the row.
 */
export const deleteEventHandler = catchAsync(
  async (req: Request, res: Response) => {
    const eventId = param(req, 'eventId');
    await eventsService.deleteEvent(req.user!.id, eventId);
    sendResponse(res, 200, null, 'Event deleted.');
  },
);

// ─── Super admin — review ────────────────────────────────────────────────────

/**
 * POST /events/admin/:eventId/approve
 * Super admin. Publishes a pending event.
 *
 * Body: { reviewNote?: string }
 */
export const approveEventHandler = catchAsync(
  async (req: Request, res: Response) => {
    const eventId = param(req, 'eventId');
    const { reviewNote } = req.body;
    const event = await eventsService.approveEvent(
      req.user!.id,
      req.user!.role,
      eventId,
      reviewNote,
    );
    sendResponse(res, 200, event, 'Event published.');
  },
);

/**
 * POST /events/admin/:eventId/reject
 * Super admin. Declines a pending event without publishing.
 *
 * Body: { reviewNote: string }
 */
export const rejectEventHandler = catchAsync(
  async (req: Request, res: Response) => {
    const eventId = param(req, 'eventId');
    const { reviewNote } = req.body;
    const event = await eventsService.rejectEvent(
      req.user!.id,
      req.user!.role,
      eventId,
      reviewNote,
    );
    sendResponse(res, 200, event, 'Event rejected.');
  },
);

/**
 * POST /events/admin/:eventId/feature
 * Super admin. Sets or clears the featured flag on a published event.
 * Enforces "at most one featured published event" in the service.
 *
 * Body: { isFeatured: boolean }
 */
export const setFeaturedEventHandler = catchAsync(
  async (req: Request, res: Response) => {
    const eventId = param(req, 'eventId');
    const { isFeatured } = req.body;
    const event = await eventsService.setFeaturedEvent(
      req.user!.id,
      req.user!.role,
      eventId,
      Boolean(isFeatured),
    );
    sendResponse(
      res,
      200,
      event,
      isFeatured ? 'Event featured.' : 'Event unfeatured.',
    );
  },
);

// ─── Admin — upload ──────────────────────────────────────────────────────────

/**
 * POST /events/admin/upload/image
 * Admin. Multipart upload of a single image.
 *
 * Body: multipart/form-data with a file in the "image" field.
 *
 * Returns `EventImageUploadResult`:
 *     { url: string, publicId: string }
 *
 * The client copies these onto the event payload as
 * `{ imageUrl: url, imagePublicId: publicId }` before saving.
 *
 * No `validate` middleware on this route — the body is multipart, not
 * JSON. Multer's `fileFilter` handles the MIME check before the handler.
 */
export const uploadEventImageHandler = catchAsync(
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError(
        'No file uploaded. Send a file under the "image" field.',
        400,
      );
    }

    // Imported lazily to keep the controller file focused on HTTP.
    // The uploader is feature-agnostic — it just forwards bytes to
    // Cloudinary under a folder.
    const { uploadBuffer } = await import('../../utils/upload');

    const result = await uploadBuffer(
      req.file.buffer,
      { folder: 'events/images', tags: ['events'] },
      req.file.mimetype,
    );

    const payload: EventImageUploadResult = {
      url: result.url,
      publicId: result.publicId,
    };

    sendResponse(res, 200, payload, 'Image uploaded.');
  },
);