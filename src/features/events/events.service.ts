// src/features/events/events.service.ts
//
// Service layer for the Events feature.
//
// Responsibilities:
//   - Public reads: list published events, read one published event.
//   - Admin reads: list all events (any status), read any by id.
//   - Admin writes: create draft, update draft, submit for review,
//     delete a draft.
//   - Super admin writes: approve (→ published), reject (→ rejected).
//   - Toggle the featured flag, enforcing "at most one featured at a
//     time" when the event is published.
//
// Nothing here talks HTTP. Controllers call these functions and shape
// the response. All row → domain mapping lives here.
//
// Images:
//   Every event may reference a Cloudinary asset via `imagePublicId`.
//   The database has no foreign key that reaches into Cloudinary, so
//   the service is responsible for destroying assets when it removes
//   or replaces the row that pointed at them. See `cleanupAsset`.

import { query } from '../../config/db';
import { AppError } from '../../utils/Apperror';
import { deleteAsset } from '../../utils/upload';
import type { Role } from '../../types/roles';
import type {
  Event,
  EventSummary,
  PublicEvent,
  PublicEventSummary,
} from './events.types';
import type {
  EventInputPayload,
  UpdateEventInputSchema,
  ListEventsQuery,
} from './events.validator';

// ─── Asset cleanup ───────────────────────────────────────────────────────────
//
// Same pattern as news.service.ts. Cloudinary assets outlive the rows
// that reference them. Any time the service removes or replaces a
// row's `imagePublicId`, the old asset must be destroyed separately.
//
// Fire-and-forget by design. The DB write has already succeeded by the
// time we get here; a Cloudinary hiccup must not roll it back or fail
// the response. `deleteAsset` already treats a missing asset as "gone",
// so a double-delete or a race with a manual cleanup is a no-op.

const cleanupAsset = (publicId: string | null): void => {
  if (!publicId) return;
  void deleteAsset(publicId);
};

// ─── Row mappers ─────────────────────────────────────────────────────────────
//
// Every row that comes out of Postgres has snake_case column names.
// Every domain type in events.types.ts is camelCase. These functions
// are the only place the conversion happens.

const mapEventRow = (row: Record<string, any>): Event => ({
  id:            row.id,
  title:         row.title,
  summary:       row.summary,
  content:       row.content,
  organizer:     row.organizer,
  category:      row.category,
  startsAt:      row.starts_at,
  endsAt:        row.ends_at,
  location:      row.location,
  imageUrl:      row.image_url,
  imagePublicId: row.image_public_id,
  isFeatured:    row.is_featured,
  status:        row.status,
  publishedAt:   row.published_at,
  createdBy:     row.created_by,
  createdByRole: row.created_by_role,
  reviewedBy:    row.reviewed_by,
  reviewedAt:    row.reviewed_at,
  reviewNote:    row.review_note,
  createdAt:     row.created_at,
  updatedAt:     row.updated_at,
});

const mapEventSummary = (row: Record<string, any>): EventSummary => ({
  id:          row.id,
  title:       row.title,
  summary:     row.summary,
  organizer:   row.organizer,
  category:    row.category,
  startsAt:    row.starts_at,
  endsAt:      row.ends_at,
  location:    row.location,
  imageUrl:    row.image_url,
  isFeatured:  row.is_featured,
  status:      row.status,
  publishedAt: row.published_at,
  createdAt:   row.created_at,
  updatedAt:   row.updated_at,
});

/**
 * Strips the internal audit fields before a row is sent to the public.
 * Keeping this here — next to the mapper — means the public endpoints
 * can't accidentally leak `reviewNote` by forgetting to filter.
 */
const toPublic = (event: Event): PublicEvent => {
  const {
    reviewNote,
    reviewedBy,
    reviewedAt,
    createdBy,
    createdByRole,
    ...rest
  } = event;
  return rest;
};

const toPublicSummary = (summary: EventSummary): PublicEventSummary => {
  const { status, ...rest } = summary;
  return rest;
};

// ─── Featured handling ───────────────────────────────────────────────────────
//
// Same invariants as News. The DB has a partial unique index:
//     CREATE UNIQUE INDEX ... ON events (is_featured)
//     WHERE is_featured = true AND status = 'published'
//
// That means at most one *published* event can be featured. When a
// published event is marked featured, the service must unfeature the
// previous one first, or the UPDATE will violate the index.
//
// Unpublished events can be marked featured freely — the index only
// applies to published rows. That lets an admin stage a featured event
// before it goes live without stealing the spot from the current one.

/**
 * Clears the featured flag from any currently-featured *published*
 * event. Does nothing if no event is currently featured.
 *
 * Must run inside the same transaction as the write that sets the new
 * featured event.
 */
const clearFeaturedPublished = async (
  run: (text: string, params?: any[]) => Promise<any>,
  exceptId?: string,
): Promise<void> => {
  if (exceptId) {
    await run(
      `UPDATE events
          SET is_featured = false,
              updated_at = NOW()
        WHERE is_featured = true
          AND status = 'published'
          AND id <> $1`,
      [exceptId],
    );
  } else {
    await run(
      `UPDATE events
          SET is_featured = false,
              updated_at = NOW()
        WHERE is_featured = true
          AND status = 'published'`,
    );
  }
};

// ─── Transaction helper ──────────────────────────────────────────────────────
//
// Same shape as news.service.ts. If your `db.ts` exposes only a
// `query(text, params)` helper, add a `withTransaction` helper there
// and swap the body of this function. Every multi-statement write
// should go through here so rollback is automatic.
//
// TODO: config/db.ts does not currently expose a `connect()` method on
// the exported `query`, so this falls through to the inline path and
// the "transaction" is not actually a transaction. That is a latent
// correctness bug for `setFeaturedEvent` and `approveEvent` (both do
// two statements that must succeed or fail together).

const withTransaction = async <T>(
  fn: (run: (text: string, params?: any[]) => Promise<any>) => Promise<T>,
): Promise<T> => {
  const client = await (query as any).connect?.();

  if (!client) {
    console.warn(
      '[events.service] No transaction support in db.ts — running inline. ' +
        'Add a `connect()` method or a `withTransaction` helper.',
    );
    return fn(query);
  }

  const run = (text: string, params?: any[]) => client.query(text, params);

  try {
    await run('BEGIN');
    const result = await fn(run);
    await run('COMMIT');
    return result;
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Date-ordering helper ────────────────────────────────────────────────────
//
// The validator enforces `endsAt >= startsAt` on create, and on update
// only when both dates are present. This is the other half: when a
// partial update supplies exactly one of the two dates, we compare it
// against the value already on the row. Without this, a PATCH could
// put the row into a state the DB CHECK constraint would then reject —
// with a less useful error message.

const assertDateOrder = (
  startsAt: string | Date,
  endsAt: string | Date,
): void => {
  if (Date.parse(String(endsAt)) < Date.parse(String(startsAt))) {
    throw new AppError(
      'End date must be on or after the start date.',
      400,
    );
  }
};

// ─── Public reads ────────────────────────────────────────────────────────────

/**
 * List published events. Paginated. Optional free-text search across
 * title, summary, and location; optional category filter; optional
 * "featured only" flag.
 *
 * Always ordered by starts_at ASC — soonest upcoming event first.
 * Completed events sort to the bottom naturally once their start
 * passes.
 */
export const listPublishedEvents = async (
  options: ListEventsQuery['query'],
): Promise<{ items: PublicEventSummary[]; total: number }> => {
  const { search, category, featured, page, limit } = options;
  const offset = (page - 1) * limit;

  const conditions: string[] = [`status = 'published'`];
  const params: any[] = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(title ILIKE $${params.length}
        OR summary ILIKE $${params.length}
        OR location ILIKE $${params.length})`,
    );
  }

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  if (featured === true) {
    conditions.push(`is_featured = true`);
  } else if (featured === false) {
    conditions.push(`is_featured = false`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [countRes, pageRes] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM events ${where}`, params),
    query(
      `SELECT id, title, summary, organizer, category,
              starts_at, ends_at, location,
              image_url, is_featured, status,
              published_at, created_at, updated_at
         FROM events
         ${where}
         ORDER BY starts_at ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
  ]);

  return {
    items: pageRes.rows.map(mapEventSummary).map(toPublicSummary),
    total: countRes.rows[0].total,
  };
};

/**
 * Read one published event by id. Throws 404 for anything that isn't
 * published — drafts and rejected events are not visible to the public.
 */
export const getPublishedEventById = async (
  id: string,
): Promise<PublicEvent> => {
  const result = await query(
    `SELECT * FROM events WHERE id = $1 AND status = 'published'`,
    [id],
  );
  if (!result.rowCount) {
    throw new AppError('Event not found.', 404);
  }
  return toPublic(mapEventRow(result.rows[0]));
};

// ─── Admin reads ─────────────────────────────────────────────────────────────

/**
 * List all events regardless of status, soonest-first by start date.
 * Used by the admin index page.
 *
 * Admin list orders by starts_at, not created_at, because admins are
 * almost always looking at the calendar, not the audit log. If you
 * want newest-created-first, swap the ORDER BY.
 */
export const listAllEvents = async (): Promise<EventSummary[]> => {
  const result = await query(
    `SELECT id, title, summary, organizer, category,
            starts_at, ends_at, location,
            image_url, is_featured, status,
            published_at, created_at, updated_at
       FROM events
       ORDER BY starts_at ASC`,
  );
  return result.rows.map(mapEventSummary);
};

/**
 * List events waiting on review. Super admin's queue.
 */
export const listPendingEvents = async (): Promise<EventSummary[]> => {
  const result = await query(
    `SELECT id, title, summary, organizer, category,
            starts_at, ends_at, location,
            image_url, is_featured, status,
            published_at, created_at, updated_at
       FROM events
       WHERE status = 'pending'
       ORDER BY starts_at ASC`,
  );
  return result.rows.map(mapEventSummary);
};

/**
 * Read any event by id, regardless of status. Used by the admin
 * editor and the review panel.
 */
export const getEventById = async (id: string): Promise<Event> => {
  const result = await query(`SELECT * FROM events WHERE id = $1`, [id]);
  if (!result.rowCount) {
    throw new AppError('Event not found.', 404);
  }
  return mapEventRow(result.rows[0]);
};

// ─── Admin writes ────────────────────────────────────────────────────────────

/**
 * Create a new draft event. The caller's id and role are stamped on
 * the row for the audit trail.
 *
 * No asset cleanup needed — nothing was replaced. The uploaded asset
 * is now referenced by the new row.
 */
export const createEvent = async (
  userId: string,
  role: Role,
  input: EventInputPayload,
): Promise<Event> => {
  const result = await query(
    `INSERT INTO events
       (title, summary, content, organizer, category,
        starts_at, ends_at, location,
        image_url, image_public_id,
        is_featured, status, created_by, created_by_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', $12, $13)
     RETURNING *`,
    [
      input.title,
      input.summary,
      input.content,
      input.organizer,
      input.category,
      input.startsAt,
      input.endsAt,
      input.location,
      input.imageUrl,
      input.imagePublicId,
      input.isFeatured,
      userId,
      role,
    ],
  );
  return mapEventRow(result.rows[0]);
};

/**
 * Update an event the caller owns. Only drafts and rejected events can
 * be edited — once pending, the content is frozen for review; once
 * published, use a super_admin action or unpublish (not implemented).
 *
 * Partial update: only fields present in `input` are changed.
 *
 * Date ordering: the validator enforces `endsAt >= startsAt` when both
 * dates are present. When only one is, this function compares it
 * against the stored value so the row never enters an invalid state
 * the DB CHECK constraint would then reject.
 *
 * If the client replaces the image, the previous Cloudinary asset is
 * destroyed after the UPDATE succeeds. See `cleanupAsset`.
 */
export const updateEvent = async (
  userId: string,
  eventId: string,
  input: UpdateEventInputSchema['payload'],
): Promise<Event> => {
  const existing = await getEventById(eventId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only edit your own events.', 403);
  }

  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected events can be edited.',
      409,
    );
  }

  // Resolve the effective dates for the ordering check. If a field
  // wasn't supplied, fall back to the stored value.
  const effectiveStartsAt = input.startsAt ?? existing.startsAt;
  const effectiveEndsAt = input.endsAt ?? existing.endsAt;
  assertDateOrder(effectiveStartsAt, effectiveEndsAt);

  // Build the SET clause from whatever fields are present.
  const fields: string[] = [];
  const params: any[] = [];

  const set = (column: string, value: any) => {
    params.push(value);
    fields.push(`${column} = $${params.length}`);
  };

  if (input.title         !== undefined) set('title',           input.title);
  if (input.summary       !== undefined) set('summary',         input.summary);
  if (input.content       !== undefined) set('content',         input.content);
  if (input.organizer     !== undefined) set('organizer',       input.organizer);
  if (input.category      !== undefined) set('category',        input.category);
  if (input.startsAt      !== undefined) set('starts_at',       input.startsAt);
  if (input.endsAt        !== undefined) set('ends_at',         input.endsAt);
  if (input.location      !== undefined) set('location',        input.location);
  if (input.imageUrl      !== undefined) set('image_url',       input.imageUrl);
  if (input.imagePublicId !== undefined) set('image_public_id', input.imagePublicId);
  if (input.isFeatured    !== undefined) set('is_featured',     input.isFeatured);

  if (fields.length === 0) {
    // Nothing to change — return the current row rather than issuing a
    // no-op UPDATE.
    return existing;
  }

  // If the client is replacing the image, capture the old public id
  // before the UPDATE so we can clean it up afterwards. We only do
  // this when the id actually changes — re-saving the same image is a
  // no-op on Cloudinary.
  const oldPublicId =
    input.imagePublicId !== undefined &&
    input.imagePublicId !== existing.imagePublicId
      ? existing.imagePublicId
      : null;

  fields.push(`updated_at = NOW()`);
  params.push(eventId);

  const result = await query(
    `UPDATE events
        SET ${fields.join(', ')}
      WHERE id = $${params.length}
      RETURNING *`,
    params,
  );

  // Row is written. Now it's safe to drop the superseded asset.
  cleanupAsset(oldPublicId);

  return mapEventRow(result.rows[0]);
};

/**
 * Submit a draft for review. Moves status draft → pending.
 */
export const submitEvent = async (
  userId: string,
  eventId: string,
): Promise<Event> => {
  const existing = await getEventById(eventId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only submit your own events.', 403);
  }
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected events can be submitted for review.',
      409,
    );
  }

  const result = await query(
    `UPDATE events
        SET status = 'pending',
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [eventId],
  );
  return mapEventRow(result.rows[0]);
};

/**
 * Delete an event. Only the owner can delete it, and only while it's
 * still a draft or rejected. Pending and published events are
 * immutable from the admin's side.
 *
 * The Cloudinary asset referenced by `imagePublicId` is destroyed
 * after the row is gone. See `cleanupAsset`.
 */
export const deleteEvent = async (
  userId: string,
  eventId: string,
): Promise<void> => {
  const existing = await getEventById(eventId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only delete your own events.', 403);
  }
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected events can be deleted.',
      409,
    );
  }

  await query('DELETE FROM events WHERE id = $1', [eventId]);

  // After the row is gone, drop the Cloudinary asset it referenced.
  // Order matters: a Cloudinary failure leaks one file; the reverse
  // order (asset first, row second) would risk a row pointing at a
  // destroyed asset.
  cleanupAsset(existing.imagePublicId);
};

// ─── Super admin review ──────────────────────────────────────────────────────

/**
 * Approve a pending event. Moves it to published, stamps published_at
 * (first time only), records the reviewer.
 *
 * If the event is marked featured, the currently-featured published
 * event is unfeatured in the same transaction — the partial unique
 * index would otherwise reject the update.
 */
export const approveEvent = async (
  reviewerId: string,
  reviewerRole: Role,
  eventId: string,
  reviewNote?: string | null,
): Promise<Event> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can approve events.', 403);
  }

  const existing = await getEventById(eventId);
  if (existing.status !== 'pending') {
    throw new AppError('Only pending events can be approved.', 409);
  }

  return withTransaction(async (run) => {
    if (existing.isFeatured) {
      await clearFeaturedPublished(run, eventId);
    }

    const result = await run(
      `UPDATE events
          SET status = 'published',
              published_at = COALESCE(published_at, NOW()),
              reviewed_by = $1,
              reviewed_at = NOW(),
              review_note = $2,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [reviewerId, reviewNote ?? null, eventId],
    );

    return mapEventRow(result.rows[0]);
  });
};

/**
 * Reject a pending event. Moves it to rejected; nothing is published.
 * The note is required by the validator, so it's always present here.
 */
export const rejectEvent = async (
  reviewerId: string,
  reviewerRole: Role,
  eventId: string,
  reviewNote: string,
): Promise<Event> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can reject events.', 403);
  }

  const existing = await getEventById(eventId);
  if (existing.status !== 'pending') {
    throw new AppError('Only pending events can be rejected.', 409);
  }

  const result = await query(
    `UPDATE events
        SET status = 'rejected',
            reviewed_by = $1,
            reviewed_at = NOW(),
            review_note = $2,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [reviewerId, reviewNote, eventId],
  );
  return mapEventRow(result.rows[0]);
};

// ─── Featured toggle (super admin) ───────────────────────────────────────────

/**
 * Set the featured flag on a published event. Enforces the "at most
 * one featured published event" rule inside a transaction.
 *
 * This is deliberately a separate endpoint from updateEvent so the
 * super admin can promote/demote an already-published event without
 * editing its content.
 */
export const setFeaturedEvent = async (
  reviewerId: string,
  reviewerRole: Role,
  eventId: string,
  isFeatured: boolean,
): Promise<Event> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError(
      'Only super admins can change the featured event.',
      403,
    );
  }

  const existing = await getEventById(eventId);
  if (existing.status !== 'published') {
    throw new AppError('Only published events can be featured.', 409);
  }

  if (!isFeatured) {
    // Unfeaturing is trivially safe — no other row is affected.
    const result = await query(
      `UPDATE events
          SET is_featured = false,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [eventId],
    );
    return mapEventRow(result.rows[0]);
  }

  return withTransaction(async (run) => {
    await clearFeaturedPublished(run, eventId);

    const result = await run(
      `UPDATE events
          SET is_featured = true,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [eventId],
    );

    return mapEventRow(result.rows[0]);
  });
};