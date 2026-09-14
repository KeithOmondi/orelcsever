// src/features/documents/documents.types.ts
//
// Domain types for the Documents feature.
//
// Model:
//   - `Document` is a single downloadable file (PDF) that isn't a
//     publication. The distinction is editorial:
//       * Publications are authored works — Bench Books, Practice
//         Directions, guidelines, reports — presented as a library
//         with preview pages and a 3D reader.
//       * Documents are operational files — cause lists, forms,
//         notices, station-specific reports — presented as a flat
//         repository with a preview modal and a download link.
//     They could share a table, but the reader UX and the metadata
//     differ enough that separate models is the simpler choice.
//   - The lifecycle mirrors News / Events / Publications:
//         draft → pending → published
//                        ↘ rejected
//     Admins create and edit drafts; super admins approve or reject.
//     Only `published` documents are visible on the public site.
//
// Differences from Publications:
//   - No preview pages. The reader is a metadata modal, not a flip
//     book. Documents are usually short and operational — a cause
//     list doesn't need a page-turning reader.
//   - Documents carry a `station`. Most are "National / All Stations",
//     but station-specific files (cause lists, station reports) are
//     common. This is the primary filter dimension after category.
//   - Documents have an `issuedAt` date (when the document is dated)
//     separate from `publishedAt` (when it went live in this system).
//     A 2014 Rules document published here in 2026 has `issuedAt` =
//     2014 and `publishedAt` = 2026.
//
// File lifecycle:
//   - The PDF is uploaded to Cloudinary, not linked.
//   - `fileUrl` is the Cloudinary secure_url; `filePublicId` is the
//     public_id used for asset cleanup on delete or replacement.
//   - `fileSize` and `fileBytes` are computed at upload time and
//     stored, so the list view doesn't have to fetch Cloudinary
//     metadata per row.

import { Role } from '../../types/roles';

// ─── Review lifecycle ────────────────────────────────────────────────────────

/**
 * Where a document is in the admin → super-admin review pipeline.
 * Identical to NewsStatus / EventStatus / PublicationStatus on purpose.
 */
export type DocumentStatus = 'draft' | 'pending' | 'published' | 'rejected';

// ─── Category ────────────────────────────────────────────────────────────────

/**
 * Fixed set of document categories. Matches the `<select>` options in
 * the public `ElcDocuments.tsx` UI.
 *
 * Stored as TEXT with a CHECK constraint on the database side, not as
 * a Postgres enum — altering an enum requires a migration, altering a
 * CHECK constraint does not.
 */
export const DOCUMENT_CATEGORIES = [
  'Practice Directions',
  'Acts & Rules',
  'Cause Lists',
  'Guidelines',
  'Reports',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

// ─── Station ─────────────────────────────────────────────────────────────────
//
// Most documents apply to the whole court and are tagged
// "National / All Stations". Station-specific documents — cause lists,
// station reports — are tagged with the station name.
//
// The list is not exhaustive of every ELC station; it covers the ones
// that appear in the mock. Adding a station is a one-line change here
// plus a migration to alter the CHECK constraint. If a document needs
// a station not in this list, either add it or use
// 'National / All Stations' as a catch-all.

export const DOCUMENT_STATIONS = [
  'National / All Stations',
  'Nairobi ELC Station',
  'Mombasa ELC Station',
  'Kisumu ELC Station',
  'Nakuru ELC Station',
  'Eldoret ELC Station',
  'Kericho ELC Station',
  'Machakos ELC Station',
  'Meru ELC Station',
  'Malindi ELC Station',
] as const;

export type DocumentStation = (typeof DOCUMENT_STATIONS)[number];

// ─── Live content — normalized shape ─────────────────────────────────────────

export interface Document {
  id: string;

  title: string;
  description: string;

  category: DocumentCategory;
  station: DocumentStation;

  /**
   * The date the document is dated — 2014 for the ELC Rules, 2023 for
   * the Practice Directions. This is separate from `publishedAt`,
   * which is when the row went live in this system.
   *
   * Stored as a DATE (no time component), serialized as an ISO date
   * string ("2014-11-20").
   */
  issuedAt: string;

  /** Cloudinary secure_url of the PDF. */
  fileUrl: string;
  /** Cloudinary public_id. Required for asset cleanup. */
  filePublicId: string;

  /**
   * Human-readable file size, e.g. "1.4 MB". Computed at upload time
   * from the Cloudinary `bytes` field and stored.
   */
  fileSize: string;

  /** Raw byte count from Cloudinary, kept for potential sorting. */
  fileBytes: number;

  status: DocumentStatus;

  /** Set the first time the document transitions to `published`. */
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
 * The subset of `Document` safe to show to the public. `reviewNote`
 * and the reviewer fields are internal, so they're omitted.
 *
 * `filePublicId` is also omitted — the public reader only needs the
 * URL to render a download link, and the public id is a server-side
 * implementation detail.
 */
export type PublicDocument = Omit<
  Document,
  | 'reviewNote'
  | 'reviewedBy'
  | 'reviewedAt'
  | 'createdBy'
  | 'createdByRole'
  | 'filePublicId'
>;

// ─── Inputs — what the service accepts ───────────────────────────────────────

/**
 * Editable fields of a document. Excludes id, status, timestamps, and
 * audit fields — set by the service, not the client.
 *
 * `fileUrl`, `filePublicId`, `fileBytes`, and `fileSize` come from the
 * upload endpoint (`POST /documents/admin/upload/file`) and are copied
 * onto the payload by the client.
 *
 * `issuedAt` is an ISO date string over the wire ("2014-11-20"), not
 * an ISO date-time. Documents have no meaningful time-of-day.
 */
export interface DocumentInput {
  title: string;
  description: string;
  category: DocumentCategory;
  station: DocumentStation;
  issuedAt: string;
  fileUrl: string;
  filePublicId: string;
  fileBytes: number;
  fileSize: string;
}

// ─── Results — what the controller returns ───────────────────────────────────

/**
 * Compact row for list views. Since documents have no `pages` and no
 * separate detail payload, this IS the shape the public list uses —
 * unlike Publications, where the summary omits `pages`.
 *
 * The only fields omitted are `filePublicId` and `fileBytes`.
 */
export interface DocumentSummary {
  id: string;
  title: string;
  description: string;
  category: DocumentCategory;
  station: DocumentStation;
  issuedAt: string;
  fileSize: string;
  fileUrl: string;
  status: DocumentStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** `DocumentSummary` minus the audit fields, for the public list endpoint. */
export type PublicDocumentSummary = Omit<DocumentSummary, 'status'>;

// ─── Upload result ───────────────────────────────────────────────────────────
//
// Same shape as PublicationFileUploadResult minus the preview pages.
// The upload endpoint is generic; Documents just don't consume `pages`.

export interface DocumentFileUploadResult {
  /** Cloudinary secure_url of the PDF. Maps to `Document.fileUrl`. */
  url: string;
  /** Cloudinary public_id. Maps to `Document.filePublicId`. */
  publicId: string;
  /** Raw byte count from Cloudinary. Maps to `Document.fileBytes`. */
  bytes: number;
  /** Human-readable size, e.g. "1.4 MB". Computed server-side. */
  fileSize: string;
}