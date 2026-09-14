// src/features/publications/publications.validator.ts
//
// Zod v4 schemas for the Publications feature.
//
// These validate *incoming HTTP request bodies* and route params, not
// outgoing responses. Response shaping is the service's job.
//
// `publicationInputSchema` is the single source of truth for the
// editable shape of a publication. Status, timestamps, and audit
// fields are never accepted from the client — they're set by the
// service.
//
// `publicationIdParamSchema` is wrapped as `{ params: { publicationId } }`
// so it works with `validate.middleware.ts`, which only reads from
// `req.params` when the schema has a `.shape.params` branch.

import { z } from 'zod';
import { PUBLICATION_CATEGORIES } from './publications.types';

// ─── Reusable primitives ─────────────────────────────────────────────────────
//
// Duplicated from news.validator.ts / events.validator.ts on purpose.
// Four features is where extraction into `validators/primitives.ts`
// starts to pay off — but I'm holding that refactor until you ask, so
// this file stands alone until then.

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

// ─── Preview pages ───────────────────────────────────────────────────────────
//
// The public reader renders a fixed set of preview pages extracted from
// the PDF at upload time. The shape here must match `PublicationPage`
// in publications.types.ts.
//
// Capped at 50 pages — a "preview" that includes the whole document is
// not a preview, and it makes the row heavy for no reader benefit. If
// you need more, raise the cap or paginate the JSONB.

const publicationPageSchema = z.object({
  pageNumber: z
    .number({ error: 'pageNumber is required.' })
    .int({ error: 'pageNumber must be an integer.' })
    .min(1, { error: 'pageNumber must be at least 1.' }),

  title: trimmedString('Page title', 200),

  content: trimmedString('Page content', 10000),
});

// ─── File URL and size ───────────────────────────────────────────────────────
//
// Both `fileUrl` and `fileSize` come from the upload endpoint
// (`POST /publications/admin/upload/file`). The client copies them onto
// the payload before saving.
//
// `fileUrl` validates the *form* of the value, not its provenance. Same
// reasoning as News and Events: an authenticated admin surface, so the
// server trusts that the URL came out of the uploader. Empty string is
// rejected — a publication without a file is not a publication.

const fileUrl = () =>
  z
    .string({ error: 'File URL is required.' })
    .trim()
    .min(1, { error: 'File URL is required.' })
    .max(500, { error: 'File URL must be 500 characters or fewer.' })
    .refine((v) => /^https?:\/\//i.test(v), {
      error: 'File URL must be a valid URL.',
    });

/**
 * Human-readable file size, e.g. "2.4 MB".
 *
 * Validates the shape strictly — a number, a space, then a unit from a
 * fixed list. This is meant to be produced by the server (from
 * Cloudinary's `bytes` field), not typed by a human, so rejecting
 * anything that doesn't match is fine.
 */
const fileSize = () =>
  z
    .string({ error: 'File size is required.' })
    .trim()
    .regex(/^\d+(\.\d+)?\s?(B|KB|MB|GB)$/i, {
      error: 'File size must look like "2.4 MB".',
    });

/**
 * Four-digit year. Stored as TEXT to avoid the "2022.0" rendering trap.
 * Bounds are loose on purpose — a "publication from 1919" is valid.
 */
const year = () =>
  z
    .string({ error: 'Year is required.' })
    .trim()
    .regex(/^\d{4}$/, { error: 'Year must be a four-digit number.' })
    .refine(
      (v) => {
        const n = Number(v);
        const now = new Date().getFullYear();
        // No upper bound on the future — a publication might be
        // scheduled for next year. Lower bound is a sanity floor.
        return n >= 1900 && n <= now + 5;
      },
      { error: 'Year is out of range.' },
    );

// ─── Publication input ───────────────────────────────────────────────────────
//
// `fileBytes` is the raw byte count from Cloudinary. It's kept alongside
// the display string so the admin list can sort by size without parsing
// "2.4 MB" back into a number.

export const publicationInputSchema = z.object({
  title:       trimmedString('Title', 300),
  description: trimmedString('Description', 2000),
  category: z.enum(PUBLICATION_CATEGORIES, {
    error: `Category must be one of: ${PUBLICATION_CATEGORIES.join(', ')}.`,
  }),
  year: year(),

  fileUrl:      fileUrl(),
  filePublicId: trimmedString('File public id', 300),
  fileBytes: z
    .number({ error: 'File size in bytes is required.' })
    .int({ error: 'File bytes must be an integer.' })
    .min(0, { error: 'File bytes cannot be negative.' }),
  fileSize: fileSize(),

  // Preview pages. Capped at 50. If the server does PDF extraction, the
  // client copies the upload response's array straight in. Otherwise
  // the client sends [] and the reader falls back to "download to view".
  pages: z
    .array(publicationPageSchema)
    .max(50, { error: 'A publication can have at most 50 preview pages.' })
    .default([]),
});

// ─── Action inputs ──────────────────────────────────────────────────────────

// POST /publications/admin
// Admin. Creates a new publication. Always lands as a draft.
export const createPublicationSchema = z.object({
  payload: publicationInputSchema,
});

// PATCH /publications/admin/:publicationId
// Admin. Updates a publication the caller owns. Partial — only the
// fields present are touched.
//
// NOTE: `.partial()` is safe here because `publicationInputSchema` has
// no cross-field `.refine()`. If you ever add one (e.g. "fileBytes must
// match fileSize"), this will need the same re-declaration dance we used
// for events.
export const updatePublicationSchema = z.object({
  payload: publicationInputSchema.partial(),
});

// POST /publications/admin/:publicationId/submit
// Admin. Moves a publication from draft → pending.
export const submitPublicationSchema = z.object({}).optional();

// POST /publications/admin/:publicationId/approve
// Super admin. Moves pending → published.
export const approvePublicationSchema = z.object({
  reviewNote: optionalTrimmedString(500),
});

// POST /publications/admin/:publicationId/reject
// Super admin. Moves pending → rejected. Note is required.
export const rejectPublicationSchema = z.object({
  reviewNote: trimmedString('Rejection reason', 500),
});

// ─── Route params ───────────────────────────────────────────────────────────
//
// Wrapped so `validate.middleware.ts` reads from `req.params`.

export const publicationIdParamSchema = z.object({
  params: z.object({
    publicationId: z.uuid({
      error: 'publicationId must be a valid UUID.',
    }),
  }),
});

// ─── Query params (public list) ─────────────────────────────────────────────
//
// The public /publications endpoint accepts optional pagination, free-
// text search, and a category filter.
//
// No `year` filter — the mock UI doesn't have one, and the category
// chips carry the browsing load. If you later want "show only 2022",
// add `year: z.string().regex(/^\d{4}$/).optional()` here and a matching
// branch in the service.

export const listPublicationsQuerySchema = z.object({
  query: z.object({
    search: z
      .string()
      .trim()
      .max(200, { error: 'Search must be 200 characters or fewer.' })
      .optional(),

    category: z
      .enum(PUBLICATION_CATEGORIES, {
        error: `Category must be one of: ${PUBLICATION_CATEGORIES.join(', ')}.`,
      })
      .optional(),

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
// publications.types.ts. If the compiler complains, the validator and
// the domain types have drifted.

export type PublicationInputPayload       = z.infer<typeof publicationInputSchema>;
export type CreatePublicationInputSchema  = z.infer<typeof createPublicationSchema>;
export type UpdatePublicationInputSchema  = z.infer<typeof updatePublicationSchema>;
export type ApprovePublicationInputSchema = z.infer<typeof approvePublicationSchema>;
export type RejectPublicationInputSchema  = z.infer<typeof rejectPublicationSchema>;
export type PublicationIdParam            = z.infer<typeof publicationIdParamSchema>;
export type ListPublicationsQuery         = z.infer<typeof listPublicationsQuerySchema>;