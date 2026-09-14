// src/features/news/news.types.ts
//
// Domain types for the News feature.
//
// Model:
//   - `News` is a single article row. There is no separate versions
//     table: an article is its own snapshot, and the `status` column
//     tracks where it is in the review lifecycle.
//   - The review lifecycle is:
//         draft → pending → published
//                        ↘ rejected
//     Admins create and edit drafts; super admins approve or reject.
//     Only `published` articles are visible on the public site.
//
// There are no categories. Articles are distinguished by their title.
//
// Images are uploaded to Cloudinary, not linked. Each article stores
// both the resolved `imageUrl` and the `imagePublicId` so the service
// can clean up the asset when an image is replaced or an article is
// deleted.

import { Role } from '../../types/roles';

// ─── Status ──────────────────────────────────────────────────────────────────

export type NewsStatus = 'draft' | 'pending' | 'published' | 'rejected';

// ─── Live content — normalized shape ─────────────────────────────────────────

export interface News {
  id: string;

  title: string;
  summary: string;
  content: string;

  author: string;

  /**
   * Cloudinary `secure_url` of the header image.
   * Empty string when the article has no image.
   */
  imageUrl: string;

  /**
   * Cloudinary `public_id`. Required for asset cleanup when the image
   * is replaced or the article is deleted. Null for legacy rows created
   * before uploads were wired.
   */
  imagePublicId: string | null;

  isFeatured: boolean;

  status: NewsStatus;

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

export type PublicNews = Omit<
  News,
  'reviewNote' | 'reviewedBy' | 'reviewedAt' | 'createdBy' | 'createdByRole'
>;

// ─── Inputs — what the service accepts ───────────────────────────────────────

/**
 * Editable fields of an article. `imageUrl` and `imagePublicId` are
 * always produced by the upload endpoint (`POST /news/admin/upload/image`)
 * and copied onto the article payload by the client. The service stores
 * them as-is and never trusts a client-supplied URL it didn't see come
 * out of the uploader.
 */
export interface NewsInput {
  title: string;
  summary: string;
  content: string;
  author: string;
  imageUrl: string;
  imagePublicId: string | null;
  isFeatured: boolean;
}

// ─── Results — what the controller returns ───────────────────────────────────

/**
 * Compact row for list views. Omits `content` — the full article body
 * is only fetched when an article is opened.
 *
 * Also omits `imagePublicId` — the list view only needs the URL to
 * render a thumbnail, and the public id is only meaningful when the
 * article is opened for editing or being deleted.
 */
export interface NewsSummary {
  id: string;
  title: string;
  summary: string;
  author: string;
  imageUrl: string;
  isFeatured: boolean;
  status: NewsStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicNewsSummary = Omit<NewsSummary, 'status'>;

// ─── Upload result ───────────────────────────────────────────────────────────
//
// The shape returned by `uploadNewsImageHandler`. This is a raw
// Cloudinary result, not an article field. The client maps it onto
// `NewsInput` before saving:
//
//     { url → imageUrl, publicId → imagePublicId }
//
// Kept as its own type so it's obvious at the call site that the two
// names are different on purpose, not a typo.

export interface NewsImageUploadResult {
  /** Cloudinary `secure_url`. Maps to `News.imageUrl`. */
  url: string;
  /** Cloudinary `public_id`. Maps to `News.imagePublicId`. */
  publicId: string;
}