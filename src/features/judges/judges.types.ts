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
//   - No file upload. Judge portraits are optional and referenced by
//     URL, not uploaded through the admin panel. If you want the same
//     Cloudinary upload flow as News/Events, tell me — the schema and
//     service change but the pattern is already established.
//   - Structured list fields. `education` and `specializations` are
//     arrays of strings, stored as JSONB. They're rendered as a list
//     and a set of chips in the detail modal.
//   - Region is a governed value (used for the filter dropdown in the
//     mock). Station is free text — station names vary and don't need
//     to be pinned. Confirm if you'd rather station also be an enum.

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
 *
 * For now, the mock stores these as pre-formatted strings
 * ("Master of Laws (LL.M) - University of Nairobi"). If you'd rather
 * keep the string form, change `education` to `string[]` and simplify
 * the validator — it's a small change.
 */
export interface EducationEntry {
  degree: string;
  institution: string;
  year?: string;
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
   * Optional portrait URL. Empty string when no portrait is available —
   * the public card falls back to a placeholder.
   *
   * Not stored as a Cloudinary public id because portraits are not
   * uploaded through this feature. If they become uploads, add
   * `imagePublicId` alongside and mirror the News/Events cleanup
   * pattern.
   */
  imageUrl: string;

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
 * Editable fields of a judge record. Excludes id, status, timestamps,
 * and audit fields — set by the service, not the client.
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
  imageUrl: string;
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
  imageUrl: string;
  status: JudgeStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** `JudgeSummary` minus the audit fields, for the public list endpoint. */
export type PublicJudgeSummary = Omit<JudgeSummary, 'status'>;