// src/features/publications/publications.types.ts
//
// Domain types for the Publications feature.
//
// Model:
//   - `Publication` is a single downloadable document (PDF). Like News
//     and Events, it is its own snapshot — there is no versions table —
//     and its `status` column tracks the publication lifecycle.
//   - The lifecycle mirrors News and Events:
//         draft → pending → published
//                        ↘ rejected
//     Admins create and edit drafts; super admins approve or reject.
//     Only `published` publications are visible on the public site.
//
// Differences from News and Events:
//   - Publications are binary. The row carries metadata + a Cloudinary
//     reference to the PDF; the file itself lives in Cloudinary.
//   - The public reader renders a set of preview `pages` extracted at
//     upload time. Storing them as JSONB on the row keeps the reader
//     self-contained — no second request per open.
//   - Publications do NOT support the `is_featured` flag. The public
//     grid renders every published publication the same way. If you
//     later want a featured publication, add the column and mirror the
//     partial unique index from News/Events.
//
// File lifecycle:
//   - The PDF is uploaded to Cloudinary, not linked.
//   - `fileUrl` is the Cloudinary secure_url; `filePublicId` is the
//     public_id used for asset cleanup on delete or replacement.
//   - `fileSize` and `pages` are computed at upload time and stored, so
//     the public list doesn't need to fetch Cloudinary metadata per row.

import { Role } from '../../types/roles';

// ─── Review lifecycle ────────────────────────────────────────────────────────

/**
 * Where a publication is in the admin → super-admin review pipeline.
 * Identical to NewsStatus and EventStatus on purpose.
 */
export type PublicationStatus = 'draft' | 'pending' | 'published' | 'rejected';

// ─── Category ────────────────────────────────────────────────────────────────

/**
 * Fixed set of publication categories. Matches the filter chips in the
 * public `Publications.tsx` UI.
 *
 * Stored as TEXT with a CHECK constraint on the database side, not as
 * a Postgres enum — altering an enum requires a migration, altering a
 * CHECK constraint does not.
 */
export const PUBLICATION_CATEGORIES = [
  'Practice Directions',
  'Guidelines & Manuals',
  'Reports',
  'Court Rules',
] as const;

export type PublicationCategory = (typeof PUBLICATION_CATEGORIES)[number];

// ─── Preview pages ───────────────────────────────────────────────────────────
//
// The public reader renders a fixed set of preview pages extracted from
// the PDF at upload time. Storing them as JSONB means the reader can
// open a publication without a second request.
//
// Not every publication needs previews — a short circular might have
// none, in which case `pages` is an empty array and the reader shows
// the "download to view" state.

export interface PublicationPage {
  /** 1-based. Rendered as "Page N" in the reader. */
  pageNumber: number;
  /** Short label, e.g. "Statutory Framework". */
  title: string;
  /** Body text shown on the page. Plain text — no HTML. */
  content: string;
}

// ─── Live content — normalized shape ─────────────────────────────────────────

export interface Publication {
  id: string;

  title: string;
  description: string;

  category: PublicationCategory;

  /** Four-digit year. Stored as TEXT to avoid the "2022 vs 2022.0" trap. */
  year: string;

  /**
   * Human-readable file size, e.g. "2.4 MB". Computed at upload time
   * from the Cloudinary `bytes` field and stored, so the list view
   * doesn't have to compute it per row.
   */
  fileSize: string;

  /** Cloudinary secure_url of the PDF. */
  fileUrl: string;
  /** Cloudinary public_id. Required for asset cleanup. */
  filePublicId: string;

  /** Raw byte count from Cloudinary, kept for potential sorting. */
  fileBytes: number;

  /**
   * Preview pages for the in-page reader. Empty array if the
   * publication has no extracted previews.
   */
  pages: PublicationPage[];

  status: PublicationStatus;

  /** Set the first time the publication transitions to `published`. */
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
 * The subset of `Publication` safe to show to the public. `reviewNote`
 * and the reviewer fields are internal, so they're omitted.
 *
 * Note that `filePublicId` is also omitted — the public reader only
 * needs the URL to render a download link, and the public id is a
 * server-side implementation detail. Leaking it wouldn't be a security
 * hole, but there's no reason to.
 */
export type PublicPublication = Omit<
  Publication,
  | 'reviewNote'
  | 'reviewedBy'
  | 'reviewedAt'
  | 'createdBy'
  | 'createdByRole'
  | 'filePublicId'
>;

// ─── Inputs — what the service accepts ───────────────────────────────────────

/**
 * Editable fields of a publication. Excludes id, status, timestamps,
 * and audit fields — set by the service, not the client.
 *
 * `fileUrl`, `filePublicId`, `fileBytes`, and `fileSize` come from the
 * upload endpoint (`POST /publications/admin/upload/file`) and are
 * copied onto the payload by the client. `pages` is also set by the
 * uploader if the server extracts them; otherwise the client posts an
 * empty array.
 */
export interface PublicationInput {
  title: string;
  description: string;
  category: PublicationCategory;
  year: string;
  fileUrl: string;
  filePublicId: string;
  fileBytes: number;
  fileSize: string;
  pages: PublicationPage[];
}

// ─── Results — what the controller returns ───────────────────────────────────

/**
 * Compact row for list views. Omits `pages` — the full preview set is
 * only fetched when a publication is opened in the reader.
 *
 * Also omits `filePublicId` and `fileBytes` — list views only need the
 * display size string and the download URL.
 */
export interface PublicationSummary {
  id: string;
  title: string;
  description: string;
  category: PublicationCategory;
  year: string;
  fileSize: string;
  fileUrl: string;
  status: PublicationStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** `PublicationSummary` minus the audit fields, for the public list endpoint. */
export type PublicPublicationSummary = Omit<PublicationSummary, 'status'>;

// ─── Upload result ───────────────────────────────────────────────────────────
//
// The shape returned by the file upload endpoint. This is the raw
// Cloudinary result plus the two derived fields (`fileSize` from
// `bytes`, and `pages` if the server extracts them).
//
// The client maps these onto `PublicationInput` before saving. Naming
// follows the same pattern as NewsImageUploadResult and
// EventImageUploadResult — the uploader returns Cloudinary-shaped data;
// the client normalizes to the article-shaped names.

export interface PublicationFileUploadResult {
  /** Cloudinary secure_url of the PDF. Maps to `Publication.fileUrl`. */
  url: string;
  /** Cloudinary public_id. Maps to `Publication.filePublicId`. */
  publicId: string;
  /** Raw byte count from Cloudinary. */
  bytes: number;
  /** Human-readable size, e.g. "2.4 MB". Computed server-side. */
  fileSize: string;
  /** Extracted preview pages, if the server does extraction. May be []. */
  pages: PublicationPage[];
}