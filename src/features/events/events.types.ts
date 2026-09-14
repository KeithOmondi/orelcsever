// src/features/events/events.types.ts
//
// Domain types for the Events feature.
//
// Model:
//   - `Event` is a single calendar entry. Like News, it is its own
//     snapshot — there is no versions table — and its `status` column
//     tracks the publication lifecycle.
//   - The lifecycle mirrors News:
//         draft → pending → published
//                        ↘ rejected
//     Admins create and edit drafts; super admins approve or reject.
//     Only `published` events are visible on the public site.
//
// Differences from News:
//   - Events have a `category` (Conference, Public Outreach, Judicial
//     Training, Publication). This is a fixed enum, not free text — the
//     public UI renders one filter chip per value.
//   - Events carry `startsAt` / `endsAt` timestamps and a location,
//     because they are calendar entries. `publishedAt` is the review
//     timestamp, not the event time.
//   - Events have a `status` for the review lifecycle AND a separate
//     `phase` (Upcoming / Ongoing / Completed) for the calendar. The
//     phase is derived from `startsAt` / `endsAt` on the client, not
//     stored — see the note on `EventPhase`.

import { Role } from '../../types/roles';

// ─── Review lifecycle ────────────────────────────────────────────────────────

/**
 * Where an event is in the admin → super-admin review pipeline.
 * Identical to NewsStatus on purpose: the same middleware, the same
 * route shape, and the same invariants apply.
 */
export type EventStatus = 'draft' | 'pending' | 'published' | 'rejected';

/**
 * Where an event is in time. Derived, not stored.
 *
 * The database stores `starts_at` and `ends_at`; the client computes
 * which phase an event is in from those two timestamps. Keeping this
 * out of the schema means an event doesn't need a nightly job to flip
 * from "Upcoming" to "Completed" — it flips on the next render.
 */
export type EventPhase = 'Upcoming' | 'Ongoing' | 'Completed';

// ─── Category ────────────────────────────────────────────────────────────────

/**
 * Fixed set of event categories. Matches the filter chips in the public
 * `Events.tsx` UI. Adding a value here requires a corresponding chip
 * there; removing one is a breaking change for stored rows.
 *
 * Stored as TEXT with a CHECK constraint on the database side, not as
 * a Postgres enum — altering an enum requires a migration, altering a
 * CHECK constraint does not.
 */
export const EVENT_CATEGORIES = [
  'Conference',
  'Public Outreach',
  'Judicial Training',
  'Publication',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

// ─── Live content — normalized shape ─────────────────────────────────────────

export interface Event {
  id: string;

  title: string;
  summary: string;
  content: string;

  /** Human-readable organizer or contact. Same role as News.author. */
  organizer: string;

  category: EventCategory;

  /**
   * When the event starts and ends. Always present — a calendar event
   * with no dates is not an event. Stored as TIMESTAMPTZ.
   */
  startsAt: Date;
  endsAt: Date;

  /** Free-text venue. "KICC, Nairobi", "Judicial Training Institute". */
  location: string;

  /** Cloudinary secure_url of the header image. Empty when none. */
  imageUrl: string;
  /** Cloudinary public_id. Null when none. */
  imagePublicId: string | null;

  isFeatured: boolean;

  status: EventStatus;

  /** Set the first time the event transitions to `published`. */
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
 * The subset of `Event` safe to show to the public. `reviewNote` and
 * the reviewer fields are internal, so they're omitted.
 */
export type PublicEvent = Omit<
  Event,
  'reviewNote' | 'reviewedBy' | 'reviewedAt' | 'createdBy' | 'createdByRole'
>;

// ─── Inputs — what the service accepts ───────────────────────────────────────

/**
 * Editable fields of an event. Excludes id, status, timestamps, and
 * audit fields — set by the service, not the client.
 *
 * `startsAt` / `endsAt` arrive as ISO strings over HTTP and are stored
 * as timestamptz. The service parses them; the validator checks that
 * they are valid ISO dates and that `endsAt >= startsAt`.
 */
export interface EventInput {
  title: string;
  summary: string;
  content: string;
  organizer: string;
  category: EventCategory;
  startsAt: string;
  endsAt: string;
  location: string;
  imageUrl: string;
  imagePublicId: string | null;
  isFeatured: boolean;
}

// ─── Results — what the controller returns ───────────────────────────────────

/**
 * Compact row for list views. Omits `content` — the full description
 * is only fetched when an event is opened.
 *
 * Includes `startsAt` / `endsAt` so the client can derive the phase
 * without a second request. Does NOT include `imagePublicId` — the
 * list only needs the URL to render a thumbnail.
 */
export interface EventSummary {
  id: string;
  title: string;
  summary: string;
  organizer: string;
  category: EventCategory;
  startsAt: Date;
  endsAt: Date;
  location: string;
  imageUrl: string;
  isFeatured: boolean;
  status: EventStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** `EventSummary` minus the audit fields, for the public list endpoint. */
export type PublicEventSummary = Omit<EventSummary, 'status'>;

// ─── Upload result ───────────────────────────────────────────────────────────
//
// Same shape as NewsImageUploadResult. The upload endpoint is feature-
// agnostic — it just returns Cloudinary's raw result. The client maps
// `{ url, publicId }` → `{ imageUrl, imagePublicId }` before saving.

export interface EventImageUploadResult {
  /** Cloudinary secure_url. Maps to `Event.imageUrl`. */
  url: string;
  /** Cloudinary public_id. Maps to `Event.imagePublicId`. */
  publicId: string;
}

// ─── Phase derivation ────────────────────────────────────────────────────────
//
// Lives here, next to the type it computes, so server and client use
// the same rule. If the rule ever changes (e.g. "Ongoing" means
// "started within the last hour"), there's exactly one place to edit.

/**
 * Compute the calendar phase of an event from its timestamps.
 *
 *   - `startsAt` in the future          → 'Upcoming'
 *   - `startsAt` past, `endsAt` future  → 'Ongoing'
 *   - `endsAt` in the past              → 'Completed'
 *
 * `now` is injectable so tests can pin a fixed point in time.
 */
export const eventPhase = (
  event: Pick<Event, 'startsAt' | 'endsAt'>,
  now: Date = new Date(),
): EventPhase => {
  if (now < event.startsAt) return 'Upcoming';
  if (now > event.endsAt) return 'Completed';
  return 'Ongoing';
};