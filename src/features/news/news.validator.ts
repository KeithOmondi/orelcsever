// src/features/news/news.validator.ts
//
// Zod v4 schemas for the News feature.
//
// These validate *incoming HTTP request bodies* and route params, not
// outgoing responses. Response shaping is the service's job.
//
// `newsInputSchema` is the single source of truth for the editable
// shape of an article. Status, timestamps, and audit fields are never
// accepted from the client — they're set by the service.
//
// `newsIdParamSchema` is wrapped as `{ params: { newsId } }` so it works
// with `validate.middleware.ts`, which only reads from `req.params`
// when the schema has a `.shape.params` branch.

import { z } from 'zod';

// ─── Reusable primitives ─────────────────────────────────────────────────────
//
// Duplicated from hero.validator.ts on purpose. If a third feature shows
// up, extract them into a shared `validators/primitives.ts`. Two features
// is below the threshold where sharing pays off — the abstraction would
// have to change both call sites whenever either needs a tweak.

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
 * Image URL as stored on an article.
 *
 * The upload endpoint (POST /news/admin/upload/image) returns a
 * Cloudinary `secure_url`, which the client copies onto the payload.
 * We accept the empty string too — a draft may have no image yet.
 *
 * This validates the *form* of the value, not its provenance. The
 * server does not verify that the URL points at a real asset; a
 * malicious admin could store an arbitrary URL. That's acceptable for
 * an authenticated admin-only surface. If that assumption ever
 * changes, replace this with a Cloudinary-account regex plus a
 * `cloudinary.api.resource()` existence check in the service.
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

// ─── Article input ───────────────────────────────────────────────────────────
//
// `imageUrl` and `imagePublicId` arrive from
// POST /news/admin/upload/image. The client puts both onto the article
// before saving.

export const newsInputSchema = z.object({
  title:   trimmedString('Title', 200),
  summary: trimmedString('Summary', 500),
  content: trimmedString('Content', 20000),
  author:  trimmedString('Author', 120),

  imageUrl: imageUrl(),
  imagePublicId: optionalTrimmedString(200),

  isFeatured: z.boolean().default(false),
});

// ─── Action inputs ──────────────────────────────────────────────────────────

// POST /news/admin
// Admin. Creates a new article. Always lands as a draft.
export const createNewsSchema = z.object({
  payload: newsInputSchema,
});

// PATCH /news/admin/:newsId
// Admin. Updates an article the caller owns. Partial — only the fields
// present are touched.
export const updateNewsSchema = z.object({
  payload: newsInputSchema.partial(),
});

// POST /news/admin/:newsId/submit
// Admin. Moves an article from draft → pending.
export const submitNewsSchema = z.object({}).optional();

// POST /news/admin/:newsId/approve
// Super admin. Moves pending → published.
export const approveNewsSchema = z.object({
  reviewNote: optionalTrimmedString(500),
});

// POST /news/admin/:newsId/reject
// Super admin. Moves pending → rejected. Note is required.
export const rejectNewsSchema = z.object({
  reviewNote: trimmedString('Rejection reason', 500),
});

// ─── Route params ───────────────────────────────────────────────────────────
//
// Wrapped so `validate.middleware.ts` reads from `req.params`.

export const newsIdParamSchema = z.object({
  params: z.object({
    newsId: z.uuid({ error: 'newsId must be a valid UUID.' }),
  }),
});

// ─── Query params (public list) ─────────────────────────────────────────────
//
// The public /news endpoint accepts optional pagination and a free-text
// search. No category filter — articles are distinguished by title.

export const listNewsQuerySchema = z.object({
  query: z.object({
    search: z
      .string()
      .trim()
      .max(200, { error: 'Search must be 200 characters or fewer.' })
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
// news.types.ts. If the compiler complains, the validator and the
// domain types have drifted.

export type NewsInputPayload          = z.infer<typeof newsInputSchema>;
export type CreateNewsInputSchema     = z.infer<typeof createNewsSchema>;
export type UpdateNewsInputSchema     = z.infer<typeof updateNewsSchema>;
export type ApproveNewsInputSchema    = z.infer<typeof approveNewsSchema>;
export type RejectNewsInputSchema     = z.infer<typeof rejectNewsSchema>;
export type NewsIdParam               = z.infer<typeof newsIdParamSchema>;
export type ListNewsQuery             = z.infer<typeof listNewsQuerySchema>;