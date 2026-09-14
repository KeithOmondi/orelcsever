// src/features/hero/hero.types.ts
//
// Domain types for the Hero section.
//
// Model:
//   - `Hero` is the *live* Hero, assembled from normalized tables
//     (hero, hero_slides, hero_badges, hero_search_card).
//   - `HeroVersion` is an immutable snapshot of the entire Hero at a
//     point in time. Approval promotes a version's payload onto the
//     live tables. Rollback copies an old version back.
//
// This split means: the public site reads normalized tables (fast,
// queryable), while the approval history lives in one simple JSON
// column on `hero_versions` (easy to reason about, easy to roll back).
//
// Slide images are uploaded, not linked. Each slide stores both the
// resolved `imageUrl` and the Cloudinary `imagePublicId`. The public id
// is what lets the service delete the asset when a slide is removed or
// replaced — a bare URL isn't enough to clean up Cloudinary.

import { Role } from '../../types/roles';

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Lifecycle of a proposed change.
 *
 *   draft     → admin is still editing; not submitted for review yet
 *   pending   → admin submitted; waiting on super_admin
 *   approved  → super_admin accepted; payload promoted to live tables
 *   rejected  → super_admin declined; payload kept for audit
 *   superseded→ a newer version was approved first; kept for history
 */
export type HeroVersionStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'superseded';

// ─── Live content — normalized shape ─────────────────────────────────────────

export interface HeroSlide {
  id: string;
  imageUrl: string;
  /** Cloudinary public id. Null for legacy slides created before uploads. */
  imagePublicId: string | null;
  altText: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface HeroBadge {
  id: string;
  label: string;        // e.g. "Jurisdiction"
  value: string;        // e.g. "Constitutional"
  icon: string;         // e.g. "FaGavel" — resolved client-side from a registry
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface HeroSearchTab {
  key: string;          // 'causelist' | 'judgments' | 'efiling'
  label: string;        // "Cause List"
  placeholder: string;  // "Search by Case No. or Party Name..."
  ctaLabel: string;     // "Find Cause List"
}

export interface HeroSearchCard {
  id: string;
  title: string;        // "Quick Access Portal"
  subtitle: string;     // "Access public records, court listings..."
  selfServiceBadge: string; // "Self-Service"
  tabs: HeroSearchTab[];
  documentsLabel: string;   // "Need legal forms?"
  documentsLinkLabel: string; // "Download Documents"
  documentsHref: string;    // "/media/documents"
  updatedAt: Date;
}

export interface Hero {
  id: string;
  badge: string;              // "Judiciary E-Services Portal Active"
  headline: string;           // "Enhancing Access to Justice for All"
  subheadline: string;        // "Welcome to the official website..."
  slides: HeroSlide[];
  badges: HeroBadge[];
  searchCard: HeroSearchCard;
  // Metadata about the currently-live version
  liveVersionId: string | null;
  updatedAt: Date;
}

// ─── Versions — snapshot shape ───────────────────────────────────────────────

/**
 * The payload captured in a version snapshot.
 * Deliberately decoupled from the live types: no IDs, no timestamps.
 * Just the content the editor set.
 *
 * Slides carry `imagePublicId` so the service can promote, replace, or
 * clean up the underlying Cloudinary asset when a version goes live.
 */
export interface HeroVersionPayload {
  badge: string;
  headline: string;
  subheadline: string;
  slides: Array<{
    imageUrl: string;
    imagePublicId: string | null;
    altText: string | null;
    ctaLabel: string | null;
    ctaHref: string | null;
    displayOrder: number;
    isActive: boolean;
  }>;
  badges: Array<{
    label: string;
    value: string;
    icon: string;
    displayOrder: number;
    isActive: boolean;
  }>;
  searchCard: {
    title: string;
    subtitle: string;
    selfServiceBadge: string;
    tabs: HeroSearchTab[];
    documentsLabel: string;
    documentsLinkLabel: string;
    documentsHref: string;
  };
}

export interface HeroVersion {
  id: string;
  status: HeroVersionStatus;
  payload: HeroVersionPayload;
  createdBy: string;          // user id
  createdByRole: Role;
  createdAt: Date;
  reviewedBy: string | null;  // super_admin user id
  reviewedAt: Date | null;
  reviewNote: string | null;  // optional reason for approve/reject
}

// ─── Inputs — what the service accepts ───────────────────────────────────────

export interface SaveHeroDraftInput {
  /** If provided, replaces this draft. Otherwise creates a new one. */
  versionId?: string;
  payload: HeroVersionPayload;
}

export interface ApproveHeroVersionInput {
  versionId: string;
  reviewNote?: string;
}

export interface RejectHeroVersionInput {
  versionId: string;
  reviewNote?: string;
}

// ─── Upload ──────────────────────────────────────────────────────────────────

/**
 * Result of a single upload. Returned by `POST /hero/upload/slide-image`
 * and stored verbatim on the slide's draft entry.
 */
export interface UploadedAsset {
  url: string;
  publicId: string;
}

// ─── Results — what the controller returns ───────────────────────────────────

export interface HeroVersionSummary {
  id: string;
  status: HeroVersionStatus;
  createdBy: string;
  createdByRole: Role;
  createdAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
}