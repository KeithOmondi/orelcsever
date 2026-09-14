// src/features/documents/documents.validator.ts
//
// Zod v4 schemas for the Documents feature.
//
// These validate *incoming HTTP request bodies* and route params, not
// outgoing responses. Response shaping is the service's job.
//
// `documentInputSchema` is the single source of truth for the editable
// shape of a document. Status, timestamps, and audit fields are never
// accepted from the client — they're set by the service.
//
// `documentIdParamSchema` is wrapped as `{ params: { documentId } }` so
// it works with `validate.middleware.ts`, which only reads from
// `req.params` when the schema has a `.shape.params` branch.

import { z } from 'zod';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATIONS,
} from './documents.types';

// ─── Reusable primitives ─────────────────────────────────────────────────────
//
// Duplicated from the other feature validators on purpose. Five features
// is where extraction into `validators/primitives.ts` starts to pay off
// in earnest — if you want that refactor, it's a single-file addition
// and a mechanical find-and-replace in each validator. Holding until
// you ask.

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

// ─── Date ────────────────────────────────────────────────────────────────────
//
// `issuedAt` is a DATE, not a TIMESTAMPTZ. Documents are dated, not
// timestamped. The wire format is "YYYY-MM-DD".
//
// The parser accepts exactly that format and rejects ISO date-times
// ("2014-11-20T00:00:00Z") so the client can't smuggle in a time
// component that would be silently dropped at the DB boundary.
//
// The transform normalizes to the same "YYYY-MM-DD" string — no
// `new Date()` conversion, because `new Date("2014-11-20")` parses as
// UTC midnight and then serializing that back to a date string depends
// on the server's timezone. Keeping it a string end-to-end avoids the
// whole class of "off by one day" bugs.

const isoDate = (field: string) =>
  z
    .string({ error: `${field} is required.` })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      error: `${field} must be a date in YYYY-MM-DD format.`,
    })
    .refine(
      (v) => {
        const d = new Date(`${v}T00:00:00Z`);
        // Reject impossible dates like 2022-02-30 — Date rolls them
        // forward silently, so compare the round-trip.
        return (
          !Number.isNaN(d.getTime()) &&
          d.toISOString().slice(0, 10) === v
        );
      },
      { error: `${field} is not a valid calendar date.` },
    )
    .refine(
      (v) => {
        // Sanity bounds: no documents dated before 1900 or more than
        // one year in the future. A 1919 gazette is plausible; a 3024
        // one is a typo.
        const year = Number(v.slice(0, 4));
        const now = new Date().getUTCFullYear();
        return year >= 1900 && year <= now + 1;
      },
      { error: `${field} is out of range.` },
    );

// ─── File fields ─────────────────────────────────────────────────────────────
//
// Same as the Publications validator. `fileUrl` and `fileSize` come
// from the upload endpoint and are copied onto the payload by the
// client.

const fileUrl = () =>
  z
    .string({ error: 'File URL is required.' })
    .trim()
    .min(1, { error: 'File URL is required.' })
    .max(500, { error: 'File URL must be 500 characters or fewer.' })
    .refine((v) => /^https?:\/\//i.test(v), {
      error: 'File URL must be a valid URL.',
    });

const fileSize = () =>
  z
    .string({ error: 'File size is required.' })
    .trim()
    .regex(/^\d+(\.\d+)?\s?(B|KB|MB|GB)$/i, {
      error: 'File size must look like "1.4 MB".',
    });

// ─── Document input ──────────────────────────────────────────────────────────

export const documentInputSchema = z.object({
  title:       trimmedString('Title', 300),
  description: trimmedString('Description', 2000),

  category: z.enum(DOCUMENT_CATEGORIES, {
    error: `Category must be one of: ${DOCUMENT_CATEGORIES.join(', ')}.`,
  }),

  station: z.enum(DOCUMENT_STATIONS, {
    error: `Station must be one of: ${DOCUMENT_STATIONS.join(', ')}.`,
  }),

  issuedAt: isoDate('Issue date'),

  fileUrl:      fileUrl(),
  filePublicId: trimmedString('File public id', 300),
  fileBytes: z
    .number({ error: 'File size in bytes is required.' })
    .int({ error: 'File bytes must be an integer.' })
    .min(0, { error: 'File bytes cannot be negative.' }),
  fileSize: fileSize(),
});

// ─── Action inputs ──────────────────────────────────────────────────────────

// POST /documents/admin
// Admin. Creates a new document. Always lands as a draft.
export const createDocumentSchema = z.object({
  payload: documentInputSchema,
});

// PATCH /documents/admin/:documentId
// Admin. Updates a document the caller owns. Partial — only the fields
// present are touched.
//
// No cross-field refinements here, so plain `.partial()` works. If you
// ever add one (e.g. "issuedAt can't be after today" as a dependent
// rule), you'll need the Events-style re-declaration.
export const updateDocumentSchema = z.object({
  payload: documentInputSchema.partial(),
});

// POST /documents/admin/:documentId/submit
// Admin. Moves a document from draft → pending.
export const submitDocumentSchema = z.object({}).optional();

// POST /documents/admin/:documentId/approve
// Super admin. Moves pending → published.
export const approveDocumentSchema = z.object({
  reviewNote: optionalTrimmedString(500),
});

// POST /documents/admin/:documentId/reject
// Super admin. Moves pending → rejected. Note is required.
export const rejectDocumentSchema = z.object({
  reviewNote: trimmedString('Rejection reason', 500),
});

// ─── Route params ───────────────────────────────────────────────────────────

export const documentIdParamSchema = z.object({
  params: z.object({
    documentId: z.uuid({
      error: 'documentId must be a valid UUID.',
    }),
  }),
});

// ─── Query params (public list) ─────────────────────────────────────────────
//
// The public /documents endpoint accepts optional pagination, free-text
// search, a category filter, and a station filter.
//
// Search covers title, description, AND station — the mock's search
// placeholder says "by title or station", so typing a station name
// should surface its documents. The service implements this with an
// ILIKE across all three columns.
//
// No date filter. Documents aren't browsed by date in the mock UI.
// Adding one later would be `issuedAfter` / `issuedBefore` as ISO date
// strings, matching the storage format.

export const listDocumentsQuerySchema = z.object({
  query: z.object({
    search: z
      .string()
      .trim()
      .max(200, { error: 'Search must be 200 characters or fewer.' })
      .optional(),

    category: z
      .enum(DOCUMENT_CATEGORIES, {
        error: `Category must be one of: ${DOCUMENT_CATEGORIES.join(', ')}.`,
      })
      .optional(),

    station: z
      .enum(DOCUMENT_STATIONS, {
        error: `Station must be one of: ${DOCUMENT_STATIONS.join(', ')}.`,
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

export type DocumentInputPayload       = z.infer<typeof documentInputSchema>;
export type CreateDocumentInputSchema  = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInputSchema  = z.infer<typeof updateDocumentSchema>;
export type ApproveDocumentInputSchema = z.infer<typeof approveDocumentSchema>;
export type RejectDocumentInputSchema  = z.infer<typeof rejectDocumentSchema>;
export type DocumentIdParam            = z.infer<typeof documentIdParamSchema>;
export type ListDocumentsQuery         = z.infer<typeof listDocumentsQuerySchema>;