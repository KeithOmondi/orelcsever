// src/features/judges/judges.types.ts
//
// Domain types for the Judges feature.
//
// Model:
//   - `Judge` is a public roster entry. It is NOT a user account — the
//     `users` table holds login credentials and roles, `judges` holds
//     the display record shown on the public "Judicial Bench" page.
//     There is no foreign key between them. If you later want admins
//     to edit their own judge profile, add a nullable `user_id`
//     column and a link, but keep the two concepts separate.
//   - The lifecycle mirrors the other features:
//         draft → pending → published
//                        ↘ rejected
//     Admins create and edit drafts; super admins approve or reject.
//     Only `published` judges are visible on the public site.
//
// Differences from the other features:
//   - Portraits ARE uploaded through the admin panel via Cloudinary.
//     The domain type exposes a single `image: ImageAsset | null`; the
//     underlying row stores two columns (`image_url`,
//     `image_public_id`) that are always written together. The
//     controller receives the uploaded file via multer, uploads it to
//     Cloudinary via `utils/upload.ts`, and hands the resulting
//     `ImageAsset | null` to the service as a separate argument.
//     Upload mechanics live in `utils/upload.ts` — this file only
//     describes the shapes that cross the service boundary.
//   - Structured list fields. `education` and `specializations` are
//     arrays, stored as JSONB. They're rendered as a list and a set
//     of chips in the detail modal.
//   - Region is a governed value (used for the filter dropdown in
//     the mock). Station is free text — station names vary and don't
//     need to be pinned. Confirm if you'd rather station also be an
//     enum.

import { Role } from '../../types/roles';

// ─── Review lifecycle ────────────────────────────────────────────────────────

/**
 * Where a judge record is in the admin → super-admin review pipeline.
 * Identical to the other features' statuses on purpose.
 */
export type JudgeStatus = 'draft' | 'pending' | 'published' | 'rejected';

// ─── Region ──────────────────────────────────────────────────────────────────

/**
 * Fixed set of regions. Matches the `<select>` options in the mock's
 * filter bar.
 *
 * Stored as TEXT with a CHECK constraint on the database side. Adding
 * a region is a one-line change here plus an ALTER TABLE.
 */
export const JUDGE_REGIONS = [
  'Nairobi',
  'Coast',
  'Rift Valley',
  'Nyanza/Western',
  'Central',
  'Eastern',
  'North Eastern',
] as const;

export type JudgeRegion = (typeof JUDGE_REGIONS)[number];

// ─── Structured list fields ──────────────────────────────────────────────────

/**
 * A single education entry. Kept as a structured object rather than a
 * plain string so the display can render the degree and the institution
 * separately, and so a future "filter by university" feature has
 * something to query.
 */
export interface EducationEntry {
  degree: string;
  institution: string;
  year?: string;
}

// ─── Cloudinary image reference ──────────────────────────────────────────────

/**
 * A stored image asset. Both fields are always present together:
 *   - `publicId` is required to later delete or replace the asset.
 *   - `url` is the secure (https) delivery URL, cached on the row so
 *     list endpoints don't have to build it on every read.
 *
 * The database enforces this pairing with a CHECK constraint. A row
 * with only one of the two columns set is impossible; if the mapper
 * ever sees one, it throws rather than degrade to a placeholder.
 *
 * "No image" is represented as `null`, not as an object with empty
 * strings — the absence of an image is a state, not a value.
 */
export interface ImageAsset {
  publicId: string;
  url: string;
}

// ─── Live content — normalized shape ─────────────────────────────────────────

export interface Judge {
  id: string;

  name: string;
  title: string;
  station: string;
  region: JudgeRegion;

  /**
   * Four-digit year the judge was appointed to the bench. Stored as
   * TEXT, same reasoning as Publication.year — avoids the "2012.0"
   * trap from numeric coercion.
   */
  appointedYear: string;

  bio: string;

  /**
   * Structured education entries. Rendered as a list in the detail
   * modal.
   */
  education: EducationEntry[];

  /**
   * Free-text specialization tags. Rendered as chips. Kept as an array
   * of strings rather than an enum — the vocabulary is fluid and
   * forcing it into a fixed set would slow editorial updates.
   */
  specializations: string[];

  /**
   * Optional portrait. `null` when no portrait has been uploaded — the
   * public card falls back to initials.
   *
   * Both fields on `ImageAsset` are written together by the service
   * whenever a new file is uploaded through the admin panel, and both
   * are cleared together when the portrait is removed.
   */
  image: ImageAsset | null;

  status: JudgeStatus;

  /** Set the first time the record transitions to `published`. */
  publishedAt: Date | null;

  // Authorship / audit
  createdBy: string;
  createdByRole: Role;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * The subset of `Judge` safe to show to the public. `reviewNote` and
 * the reviewer fields are internal, so they're omitted.
 */
export type PublicJudge = Omit<
  Judge,
  'reviewNote' | 'reviewedBy' | 'reviewedAt' | 'createdBy' | 'createdByRole'
>;

// ─── Inputs — what the service accepts ───────────────────────────────────────

/**
 * Editable fields of a judge record.
 *
 * Excludes id, status, timestamps, and audit fields — those are set by
 * the service, not the client.
 *
 * Excludes the image. Portraits travel as a multipart file, not as JSON,
 * because the client sends bytes that the server must upload before the
 * row can be written. The service's `createJudge` / `updateJudge`
 * functions take the resulting `ImageAsset | null` as a separate
 * argument:
 *
 *   - createJudge(userId, role, input, image: ImageAsset | null)
 *   - updateJudge(userId, judgeId, input, image: ImageAsset | null | undefined)
 *
 * On update, `undefined` means "leave the existing portrait alone",
 * `null` means "clear it", and an `ImageAsset` means "replace it".
 * Nothing else in this codebase uses that three-state distinction, so
 * it's documented at the service boundary rather than here.
 */
export interface JudgeInput {
  name: string;
  title: string;
  station: string;
  region: JudgeRegion;
  appointedYear: string;
  bio: string;
  education: EducationEntry[];
  specializations: string[];
}

// ─── Results — what the controller returns ───────────────────────────────────

/**
 * Compact row for list views. Since a judge record has no separate
 * `content` payload — the bio and the structured fields are the whole
 * record — this IS what the public list uses, minus the audit fields.
 *
 * The only fields omitted relative to `Judge` are the audit trail.
 */
export interface JudgeSummary {
  id: string;
  name: string;
  title: string;
  station: string;
  region: JudgeRegion;
  appointedYear: string;
  bio: string;
  education: EducationEntry[];
  specializations: string[];
  image: ImageAsset | null;
  status: JudgeStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** `JudgeSummary` minus the audit fields, for the public list endpoint. */
export type PublicJudgeSummary = Omit<JudgeSummary, 'status'>;