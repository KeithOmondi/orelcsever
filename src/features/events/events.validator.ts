// src/features/events/events.validator.ts
//
// Zod v4 schemas for the Events feature.
//
// These validate *incoming HTTP request bodies* and route params, not
// outgoing responses. Response shaping is the service's job.
//
// `eventInputSchema` is the single source of truth for the editable
// shape of an event. Status, timestamps, and audit fields are never
// accepted from the client — they're set by the service.
//
// `eventIdParamSchema` is wrapped as `{ params: { eventId } }` so it
// works with `validate.middleware.ts`, which only reads from
// `req.params` when the schema has a `.shape.params` branch.

import { z } from 'zod';
import { EVENT_CATEGORIES } from './events.types';

// ─── Reusable primitives ─────────────────────────────────────────────────────
//
// Duplicated from news.validator.ts and hero.validator.ts on purpose.
// If a fourth feature shows up, extract them into
// `validators/primitives.ts`. Three features is where the sharing
// starts to pay off — but I'm holding the extraction until you ask
// for it, so this file stands alone until then.

const trimmedString = (field: string, max = 500) =>
  z
    .string({ error: `${field} is required.` })
    .trim()
    .min(1, { error: `${field} is required.` })
    .max(max, { error: `${field} must be ${max} characters or fewer.` });

const optionalTrimmedString = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, { error: `Must be ${max} characters or fewer.` })
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v ?? null));

/**
 * Image URL as stored on an event.
 *
 * Same rationale as news.validator.ts: the upload endpoint returns a
 * Cloudinary secure_url which the client copies onto the payload. This
 * checks the *form* of the value, not its provenance. The empty string
 * is allowed — a draft may have no image yet.
 */
const imageUrl = () =>
  z
    .string({ error: 'Image URL is required.' })
    .trim()
    .max(500, { error: 'Image URL must be 500 characters or fewer.' })
    .refine(
      (v) => v === '' || /^https?:\/\//i.test(v),
      { error: 'Image URL must be a valid URL.' },
    );

/**
 * ISO 8601 date-time string. Accepts what `new Date(s)` can parse
 * losslessly — i.e. an explicit timezone or Z suffix, or the
 * datetime-local format `YYYY-MM-DDTHH:mm[:ss]` which JS parses as
 * local time.
 *
 * Rejects anything `new Date()` would treat as Invalid Date, so a
 * malformed string can't sneak into the `starts_at` / `ends_at`
 * columns and blow up later.
 */
const isoDateTime = (field: string) =>
  z
    .string({ error: `${field} is required.` })
    .trim()
    .min(1, { error: `${field} is required.` })
    .refine((v) => !Number.isNaN(Date.parse(v)), {
      error: `${field} must be a valid ISO 8601 date-time.`,
    })
    .transform((v) => new Date(v).toISOString());

// ─── Event input ─────────────────────────────────────────────────────────────
//
// `startsAt` / `endsAt` are ISO strings over the wire. The schema
// normalizes them to canonical ISO (UTC) via `.transform`, and the
// `.refine` on the outer object enforces `endsAt >= startsAt` — a
// cross-field rule that can't be expressed on either field alone.

export const eventInputSchema = z
  .object({
    title:     trimmedString('Title', 200),
    summary:   trimmedString('Summary', 500),
    content:   trimmedString('Content', 20000),
    organizer: trimmedString('Organizer', 120),

    category: z.enum(EVENT_CATEGORIES, {
      error: `Category must be one of: ${EVENT_CATEGORIES.join(', ')}.`,
    }),

    startsAt: isoDateTime('Start date'),
    endsAt:   isoDateTime('End date'),

    location: trimmedString('Location', 300),

    imageUrl: imageUrl(),
    imagePublicId: optionalTrimmedString(200),

    isFeatured: z.boolean().default(false),
  })
  .refine(
    (data) => Date.parse(data.endsAt) >= Date.parse(data.startsAt),
    {
      error: 'End date must be on or after the start date.',
      path: ['endsAt'],
    },
  );

// ─── Action inputs ──────────────────────────────────────────────────────────

// POST /events/admin
// Admin. Creates a new event. Always lands as a draft.
export const createEventSchema = z.object({
  payload: eventInputSchema,
});

// PATCH /events/admin/:eventId
// Admin. Updates an event the caller owns. Partial — only the fields
// present are touched.
//
// NOTE: `.partial()` cannot be applied to the refined object directly
// because Zod doesn't allow `.partial()` on a schema that carries a
// cross-field `.refine()`. We re-declare the object and re-apply the
// refinement conditionally, so a partial update that changes only one
// of the two dates still validates when it can, and lets the service
// enforce ordering against the stored row.
export const updateEventSchema = z.object({
  payload: z
    .object({
      title:     trimmedString('Title', 200).optional(),
      summary:   trimmedString('Summary', 500).optional(),
      content:   trimmedString('Content', 20000).optional(),
      organizer: trimmedString('Organizer', 120).optional(),

      category: z
        .enum(EVENT_CATEGORIES, {
          error: `Category must be one of: ${EVENT_CATEGORIES.join(', ')}.`,
        })
        .optional(),

      startsAt: isoDateTime('Start date').optional(),
      endsAt:   isoDateTime('End date').optional(),

      location: trimmedString('Location', 300).optional(),

      imageUrl: imageUrl().optional(),
      imagePublicId: optionalTrimmedString(200),

      isFeatured: z.boolean().optional(),
    })
    .refine(
      (data) => {
        // If both dates are supplied, they must be ordered. If only
        // one is supplied, the service compares it against the other
        // value already on the row — that check belongs there, not
        // here, because this schema has no access to stored state.
        if (data.startsAt && data.endsAt) {
          return Date.parse(data.endsAt) >= Date.parse(data.startsAt);
        }
        return true;
      },
      {
        error: 'End date must be on or after the start date.',
        path: ['endsAt'],
      },
    ),
});

// POST /events/admin/:eventId/submit
// Admin. Moves an event from draft → pending.
export const submitEventSchema = z.object({}).optional();

// POST /events/admin/:eventId/approve
// Super admin. Moves pending → published.
export const approveEventSchema = z.object({
  reviewNote: optionalTrimmedString(500),
});

// POST /events/admin/:eventId/reject
// Super admin. Moves pending → rejected. Note is required.
export const rejectEventSchema = z.object({
  reviewNote: trimmedString('Rejection reason', 500),
});

// POST /events/admin/:eventId/feature
// Super admin. Toggles the featured flag on a published event.
export const setFeaturedSchema = z.object({
  isFeatured: z.boolean({ error: 'isFeatured must be a boolean.' }),
});

// ─── Route params ───────────────────────────────────────────────────────────
//
// Wrapped so `validate.middleware.ts` reads from `req.params`.

export const eventIdParamSchema = z.object({
  params: z.object({
    eventId: z.uuid({ error: 'eventId must be a valid UUID.' }),
  }),
});

// ─── Query params (public list) ─────────────────────────────────────────────
//
// The public /events endpoint accepts optional pagination, free-text
// search, a category filter, and a "featured only" flag.
//
// `phase` is deliberately NOT a query param. Phase is derived from
// starts_at / ends_at at render time; filtering by it server-side
// would either need a computed column or an expression in the WHERE
// clause, and neither is worth the complexity while the public list
// is small enough to filter client-side.

export const listEventsQuerySchema = z.object({
  query: z.object({
    search: z
      .string()
      .trim()
      .max(200, { error: 'Search must be 200 characters or fewer.' })
      .optional(),

    category: z
      .enum(EVENT_CATEGORIES, {
        error: `Category must be one of: ${EVENT_CATEGORIES.join(', ')}.`,
      })
      .optional(),

    featured: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),

    page: z
      .string()
      .optional()
      .transform((v) => (v === undefined ? 1 : Number(v)))
      .pipe(
        z
          .number()
          .int({ error: 'page must be an integer.' })
          .min(1, { error: 'page must be at least 1.' }),
      ),

    limit: z
      .string()
      .optional()
      .transform((v) => (v === undefined ? 20 : Number(v)))
      .pipe(
        z
          .number()
          .int({ error: 'limit must be an integer.' })
          .min(1, { error: 'limit must be at least 1.' })
          .max(50, { error: 'limit must be 50 or fewer.' }),
      ),
  }),
});

// ─── Inferred types ─────────────────────────────────────────────────────────
//
// These should be assignable to the corresponding entries in
// events.types.ts. If the compiler complains, the validator and the
// domain types have drifted.

export type EventInputPayload       = z.infer<typeof eventInputSchema>;
export type CreateEventInputSchema  = z.infer<typeof createEventSchema>;
export type UpdateEventInputSchema  = z.infer<typeof updateEventSchema>;
export type ApproveEventInputSchema = z.infer<typeof approveEventSchema>;
export type RejectEventInputSchema  = z.infer<typeof rejectEventSchema>;
export type EventIdParam            = z.infer<typeof eventIdParamSchema>;
export type ListEventsQuery         = z.infer<typeof listEventsQuerySchema>;