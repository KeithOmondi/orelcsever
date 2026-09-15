// src/features/judges/judges.validator.ts
//
// Zod v4 schemas for the Judges feature.
//
// These validate *incoming HTTP request bodies* and route params, not
// outgoing responses. Response shaping is the service's job.
//
// `judgeInputSchema` is the single source of truth for the editable
// shape of a judge record. Status, timestamps, and audit fields are
// never accepted from the client — they're set by the service.
//
// The image is NOT part of `judgeInputSchema`. Portraits are uploaded
// as multipart files; multer hands the bytes to the controller, which
// uploads to Cloudinary via `utils/upload.ts` and passes the resulting
// `ImageAsset | null` straight to the service. Keeping the image out
// of the JSON schema means the upload path and the edit path don't
// have to agree on a URL string, and the service stays upload-agnostic.
//
// `judgeIdParamSchema` is wrapped as `{ params: { judgeId } }` so it
// works with `validate.middleware.ts`, which only reads from
// `req.params` when the schema has a `.shape.params` branch.
//
// Multipart contract:
//   - `POST /judges/admin` and `PATCH /judges/admin/:judgeId` accept
//     `multipart/form-data`. The text half travels as a single field
//     named `payload`, containing a JSON-encoded object. The
//     controller's `extractPayload` helper JSON.parses it before this
//     validator runs.
//   - `createJudgeSchema` / `updateJudgeSchema` therefore describe the
//     shape of `req.body.payload` after parsing, not the raw form.
//     The middleware unwraps them accordingly.
//
// Authorization:
//   These schemas validate *shape*, not *who*. Any caller who gets
//   past the route middleware (adminOnly or superAdminOnly) can reach
//   the handler. The service layer decides whether the caller is
//   allowed to act on the specific record:
//     - Regular admins: own drafts / rejected records only.
//     - Super admins:   any record, any status.
//   Both roles share the same input schema because both edit the same
//   fields. There is no "super admin only" field.

import { z } from 'zod';
import { JUDGE_REGIONS } from './judges.types';

// ─── Reusable primitives ─────────────────────────────────────────────────────
//
// Duplicated from the other feature validators on purpose. Six features
// is well past the threshold where extraction would pay off — if you
// want that refactor now, it's a single-file addition plus a mechanical
// find-and-replace in each validator. Holding until you ask.

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

// ─── Appointed year ──────────────────────────────────────────────────────────
//
// Four-digit string, bounded to a plausible range. The mock uses values
// from 2012 to 2021. The lower bound is generous — a judge appointed in
// 1990 could legitimately appear on the roster — and the upper bound is
// one year ahead so a scheduled future appointment doesn't get
// rejected.

const appointedYear = () =>
  z
    .string({ error: 'Appointed year is required.' })
    .trim()
    .regex(/^\d{4}$/, { error: 'Appointed year must be a four-digit number.' })
    .refine(
      (v) => {
        const n = Number(v);
        const now = new Date().getFullYear();
        return n >= 1970 && n <= now + 1;
      },
      { error: 'Appointed year is out of range.' },
    );

// ─── Education entry ─────────────────────────────────────────────────────────
//
// One entry per degree. Splitting degree from institution means the
// detail modal can render them separately, and a future "find judges
// who studied at X" feature has something to query.
//
// `year` is optional. An empty string from the form field is allowed
// and normalized to `undefined`. A four-digit value must fall in the
// same plausible range as `appointedYear` — a graduation year of 1000
// is a placeholder, not a date. The range check catches form typos
// before they land in the database.

const educationYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, { error: 'Year must be a four-digit number.' })
  .refine(
    (v) => {
      const n = Number(v);
      const now = new Date().getFullYear();
      return n >= 1950 && n <= now + 1;
    },
    { error: 'Year is out of range.' },
  )
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' ? undefined : v));

const educationEntrySchema = z.object({
  degree: trimmedString('Degree', 200),
  institution: trimmedString('Institution', 200),
  year: educationYearSchema,
});

// ─── Specializations ─────────────────────────────────────────────────────────
//
// Free-text tags. Each is a short label; the cap is generous enough for
// realistic entries ("Maritime & Coastal Land Rights") and tight enough
// to catch someone pasting a paragraph.
//
// The array is capped at 10 entries — a judge with more than ten
// specializations is not really specializing. Adjust the cap if you
// need to.

const specializationSchema = z
  .string({ error: 'Specialization must be a string.' })
  .trim()
  .min(1, { error: 'Specialization cannot be empty.' })
  .max(100, { error: 'Specialization must be 100 characters or fewer.' });

// ─── Judge input ─────────────────────────────────────────────────────────────
//
// Everything except the image. The image arrives as a multipart file
// and is handled by the controller before the service is called.
//
// Region is a governed enum; station is free text. Appointed year is a
// four-digit string, not a number, to preserve leading zeros and avoid
// the "2012.0" trap.
//
// `education` requires at least one entry. Unlike `specializations`,
// which can legitimately be empty for a judge with no declared focus
// areas, an empty education list makes the public modal render "No
// qualifications recorded", which reads as incomplete data rather than
// an honest absence. The floor is editorial policy, not a data
// constraint.

export const judgeInputSchema = z.object({
  name:  trimmedString('Name', 200),
  title: trimmedString('Title', 200),

  station: trimmedString('Station', 200),

  region: z.enum(JUDGE_REGIONS, {
    error: `Region must be one of: ${JUDGE_REGIONS.join(', ')}.`,
  }),

  appointedYear: appointedYear(),

  bio: trimmedString('Biography', 5000),

  education: z
    .array(educationEntrySchema)
    .min(1, { error: 'At least one education entry is required.' })
    .max(10, { error: 'A judge can have at most 10 education entries.' }),

  specializations: z
    .array(specializationSchema)
    .max(10, { error: 'A judge can have at most 10 specializations.' })
    .default([]),
});

// ─── Action inputs ──────────────────────────────────────────────────────────

// POST /judges/admin
// Admin or super admin. Creates a new judge record. Always lands as a
// draft — publishing requires a separate submit + approve cycle.
//
// Multipart body. The text half travels as `payload`, a JSON string
// that the controller JSON.parses before validation. The optional image
// travels as a file and never touches this schema.
export const createJudgeSchema = z.object({
  payload: judgeInputSchema,
});

// PATCH /judges/admin/:judgeId
// Admin or super admin. Partial — only the fields present are touched.
//
// Authorization lives in the service, not here:
//   - Regular admins may only patch their own draft / rejected records.
//   - Super admins may patch any record, any status.
// Both roles send the same payload shape; the service decides whether
// to apply it.
//
// No cross-field refinements here, so plain `.partial()` works. The
// nested arrays (`education`, `specializations`) become optional too,
// which is the behavior we want: a PATCH that only updates `bio` leaves
// the existing arrays alone.
//
// Image semantics on update are decided by the controller, not this
// schema, because the image is a file:
//   - No file attached   → leave the existing portrait alone.
//   - File attached      → replace the portrait. The service deletes
//                          the previous Cloudinary asset after the DB
//                          write commits.
//   - Clear without replacement → not expressible via PATCH. The
//     service supports it (`image: null`), but no route exposes it.
//     When you want it, add `DELETE /judges/admin/:judgeId/image`.
export const updateJudgeSchema = z.object({
  payload: judgeInputSchema.partial(),
});

// POST /judges/admin/:judgeId/submit
// Admin. Moves a judge record from draft → pending.
//
// No body. Declared as a real `ZodObject` (empty) rather than
// `z.object({}).optional()` so `validate.middleware.ts` recognizes it
// as a schema it owns and doesn't fall back to its generic body-
// validation branch — which logs a second time for no reason.
export const submitJudgeSchema = z.object({});

// POST /judges/admin/:judgeId/approve
// Super admin. Moves pending → published.
export const approveJudgeSchema = z.object({
  reviewNote: optionalTrimmedString(500),
});

// POST /judges/admin/:judgeId/reject
// Super admin. Moves pending → rejected. Note is required.
export const rejectJudgeSchema = z.object({
  reviewNote: trimmedString('Rejection reason', 500),
});

// ─── Route params ───────────────────────────────────────────────────────────

export const judgeIdParamSchema = z.object({
  params: z.object({
    judgeId: z.uuid({
      error: 'judgeId must be a valid UUID.',
    }),
  }),
});

// ─── Query params (public list) ─────────────────────────────────────────────
//
// The public /judges endpoint accepts optional pagination, free-text
// search, and a region filter.
//
// Search covers name, station, and title — the mock's search placeholder
// says "by judge name or station", so typing a station should surface
// its judges. The service implements this with an ILIKE across all
// three columns.
//
// No filter by specialization or appointedYear. Neither appears as a
// browsing axis in the mock, and pinning a specialization filter would
// require promoting it to an enum — which we deliberately didn't do.

export const listJudgesQuerySchema = z.object({
  query: z.object({
    search: z
      .string()
      .trim()
      .max(200, { error: 'Search must be 200 characters or fewer.' })
      .optional(),

    region: z
      .enum(JUDGE_REGIONS, {
        error: `Region must be one of: ${JUDGE_REGIONS.join(', ')}.`,
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
// judges.types.ts. If the compiler complains, the validator and the
// domain types have drifted.
//
// Note: `JudgeInputPayload` contains no image. The service's
// `createJudge` / `updateJudge` take the uploaded `ImageAsset` as a
// separate argument — see judges.service.ts.

export type JudgeInputPayload       = z.infer<typeof judgeInputSchema>;
export type CreateJudgeInputSchema  = z.infer<typeof createJudgeSchema>;
export type UpdateJudgeInputSchema  = z.infer<typeof updateJudgeSchema>;
export type ApproveJudgeInputSchema = z.infer<typeof approveJudgeSchema>;
export type RejectJudgeInputSchema  = z.infer<typeof rejectJudgeSchema>;
export type JudgeIdParam            = z.infer<typeof judgeIdParamSchema>;
export type ListJudgesQuery         = z.infer<typeof listJudgesQuerySchema>;