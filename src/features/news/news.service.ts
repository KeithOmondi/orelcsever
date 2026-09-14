// src/features/news/news.service.ts
//
// Service layer for the News feature.
//
// Responsibilities:
//   - Public reads: list published articles, read one published article.
//   - Admin reads: list all articles (any status), read any by id.
//   - Admin writes: create draft, update draft, submit for review,
//     delete a draft.
//   - Super admin writes: approve (→ published), reject (→ rejected).
//   - Toggle the featured flag, enforcing "at most one featured at a
//     time" when the article is published.
//
// Nothing here talks HTTP. Controllers call these functions and shape
// the response. All row → domain mapping lives here.
//
// Images:
//   Every article may reference a Cloudinary asset via `imagePublicId`.
//   The database has no foreign key that reaches into Cloudinary, so
//   the service is responsible for destroying assets when it removes
//   or replaces the row that pointed at them. See `cleanupAsset`.

import { query } from '../../config/db';
import { AppError } from '../../utils/Apperror';
import { deleteAsset } from '../../utils/upload';
import type { Role } from '../../types/roles';
import type {
  News,
  NewsSummary,
  PublicNews,
  PublicNewsSummary,
} from './news.types';
import type {
  NewsInputPayload,
  UpdateNewsInputSchema,
  ListNewsQuery,
} from './news.validator';

// ─── Asset cleanup ───────────────────────────────────────────────────────────
//
// Cloudinary assets outlive the rows that reference them. Any time the
// service removes or replaces a row's `imagePublicId`, the old asset
// must be destroyed separately.
//
// Fire-and-forget by design. The DB write has already succeeded by the
// time we get here; a Cloudinary hiccup must not roll it back or fail
// the response. `deleteAsset` already treats a missing asset as "gone",
// so a double-delete or a race with a manual cleanup is a no-op.

const cleanupAsset = (publicId: string | null): void => {
  if (!publicId) return;
  // Deliberately not awaited. See comment above.
  void deleteAsset(publicId);
};

// ─── Row mappers ─────────────────────────────────────────────────────────────
//
// Every row that comes out of Postgres has snake_case column names.
// Every domain type in news.types.ts is camelCase. These functions are
// the only place the conversion happens.

const mapNewsRow = (row: Record<string, any>): News => ({
  id:            row.id,
  title:         row.title,
  summary:       row.summary,
  content:       row.content,
  author:        row.author,
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

const mapNewsSummary = (row: Record<string, any>): NewsSummary => ({
  id:          row.id,
  title:       row.title,
  summary:     row.summary,
  author:      row.author,
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
const toPublic = (news: News): PublicNews => {
  const {
    reviewNote,
    reviewedBy,
    reviewedAt,
    createdBy,
    createdByRole,
    ...rest
  } = news;
  return rest;
};

const toPublicSummary = (summary: NewsSummary): PublicNewsSummary => {
  const { status, ...rest } = summary;
  return rest;
};

// ─── Featured handling ───────────────────────────────────────────────────────
//
// The DB has a partial unique index:
//     CREATE UNIQUE INDEX ... ON news (is_featured)
//     WHERE is_featured = true AND status = 'published'
//
// That means at most one *published* article can be featured. When a
// published article is marked featured, the service must unfeature the
// previous one first, or the UPDATE will violate the index.
//
// Unpublished articles can be marked featured freely — the index only
// applies to published rows. That lets an admin stage a featured article
// before it goes live without stealing the spot from the current one.

/**
 * Clears the featured flag from any currently-featured *published*
 * article. Does nothing if no article is currently featured.
 *
 * Must run inside the same transaction as the write that sets the new
 * featured article.
 */
const clearFeaturedPublished = async (
  run: (text: string, params?: any[]) => Promise<any>,
  exceptId?: string,
): Promise<void> => {
  if (exceptId) {
    await run(
      `UPDATE news
          SET is_featured = false,
              updated_at = NOW()
        WHERE is_featured = true
          AND status = 'published'
          AND id <> $1`,
      [exceptId],
    );
  } else {
    await run(
      `UPDATE news
          SET is_featured = false,
              updated_at = NOW()
        WHERE is_featured = true
          AND status = 'published'`,
    );
  }
};

// ─── Transaction helper ──────────────────────────────────────────────────────
//
// Same shape as hero.service.ts. If your `db.ts` exposes only a
// `query(text, params)` helper, add a `withTransaction` helper there
// and swap the body of this function. Every multi-statement write
// should go through here so rollback is automatic.
//
// TODO: config/db.ts does not currently expose a `connect()` method on
// the exported `query`, so this falls through to the inline path and
// the "transaction" is not actually a transaction. That is a latent
// correctness bug for `setFeaturedNews` and `approveNews` (both do two
// statements that must succeed or fail together). Fix by exporting a
// real `withTransaction` from config/db.ts backed by a pg Pool.

const withTransaction = async <T>(
  fn: (run: (text: string, params?: any[]) => Promise<any>) => Promise<T>,
): Promise<T> => {
  const client = await (query as any).connect?.();

  if (!client) {
    // No transaction support — run inline. Correctness for a single
    // statement is unaffected; multi-statement writes lose atomicity.
    // Log loudly so this doesn't quietly ship to production.
    console.warn(
      '[news.service] No transaction support in db.ts — running inline. ' +
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

// ─── Public reads ────────────────────────────────────────────────────────────

/**
 * List published articles. Paginated. Optional free-text search across
 * title and summary, optional "featured only" filter.
 *
 * Always ordered by published_at DESC — most recent first.
 */
export const listPublishedNews = async (
  options: ListNewsQuery['query'],
): Promise<{ items: PublicNewsSummary[]; total: number }> => {
  const { search, featured, page, limit } = options;
  const offset = (page - 1) * limit;

  const conditions: string[] = [`status = 'published'`];
  const params: any[] = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(title ILIKE $${params.length} OR summary ILIKE $${params.length})`,
    );
  }

  if (featured === true) {
    conditions.push(`is_featured = true`);
  } else if (featured === false) {
    conditions.push(`is_featured = false`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  // Count + page in parallel. Both hit the same filter, so the count
  // stays accurate even as new articles are published between queries.
  const [countRes, pageRes] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM news ${where}`, params),
    query(
      `SELECT id, title, summary, author, image_url, is_featured,
              status, published_at, created_at, updated_at
         FROM news
         ${where}
         ORDER BY published_at DESC NULLS LAST
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
  ]);

  return {
    items: pageRes.rows.map(mapNewsSummary).map(toPublicSummary),
    total: countRes.rows[0].total,
  };
};

/**
 * Read one published article by id. Throws 404 for anything that isn't
 * published — drafts and rejected articles are not visible to the public.
 */
export const getPublishedNewsById = async (id: string): Promise<PublicNews> => {
  const result = await query(
    `SELECT * FROM news WHERE id = $1 AND status = 'published'`,
    [id],
  );
  if (!result.rowCount) {
    throw new AppError('Article not found.', 404);
  }
  return toPublic(mapNewsRow(result.rows[0]));
};

// ─── Admin reads ─────────────────────────────────────────────────────────────

/**
 * List all articles regardless of status, newest first. Used by the
 * admin index page.
 */
export const listAllNews = async (): Promise<NewsSummary[]> => {
  const result = await query(
    `SELECT id, title, summary, author, image_url, is_featured,
            status, published_at, created_at, updated_at
       FROM news
       ORDER BY created_at DESC`,
  );
  return result.rows.map(mapNewsSummary);
};

/**
 * List articles waiting on review. Super admin's queue.
 */
export const listPendingNews = async (): Promise<NewsSummary[]> => {
  const result = await query(
    `SELECT id, title, summary, author, image_url, is_featured,
            status, published_at, created_at, updated_at
       FROM news
       WHERE status = 'pending'
       ORDER BY created_at ASC`,
  );
  return result.rows.map(mapNewsSummary);
};

/**
 * Read any article by id, regardless of status. Used by the admin
 * editor and the review panel.
 */
export const getNewsById = async (id: string): Promise<News> => {
  const result = await query(`SELECT * FROM news WHERE id = $1`, [id]);
  if (!result.rowCount) {
    throw new AppError('Article not found.', 404);
  }
  return mapNewsRow(result.rows[0]);
};

// ─── Admin writes ────────────────────────────────────────────────────────────

/**
 * Create a new draft article. The caller's id and role are stamped on
 * the row for the audit trail.
 *
 * No asset cleanup needed here — nothing was replaced. The uploaded
 * asset is now referenced by the new row.
 */
export const createNews = async (
  userId: string,
  role: Role,
  input: NewsInputPayload,
): Promise<News> => {
  const result = await query(
    `INSERT INTO news
       (title, summary, content, author,
        image_url, image_public_id,
        is_featured, status, created_by, created_by_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9)
     RETURNING *`,
    [
      input.title,
      input.summary,
      input.content,
      input.author,
      input.imageUrl,
      input.imagePublicId,
      input.isFeatured,
      userId,
      role,
    ],
  );
  return mapNewsRow(result.rows[0]);
};

/**
 * Update an article the caller owns. Only drafts and rejected articles
 * can be edited — once pending, the content is frozen for review; once
 * published, use a super_admin action or unpublish (not implemented).
 *
 * Partial update: only fields present in `input` are changed.
 *
 * If the client replaces the image, the previous Cloudinary asset is
 * destroyed after the UPDATE succeeds. See `cleanupAsset`.
 */
export const updateNews = async (
  userId: string,
  newsId: string,
  input: UpdateNewsInputSchema['payload'],
): Promise<News> => {
  const existing = await getNewsById(newsId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only edit your own articles.', 403);
  }

  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected articles can be edited.',
      409,
    );
  }

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
  if (input.author        !== undefined) set('author',          input.author);
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
  params.push(newsId);

  const result = await query(
    `UPDATE news
        SET ${fields.join(', ')}
      WHERE id = $${params.length}
      RETURNING *`,
    params,
  );

  // Row is written. Now it's safe to drop the superseded asset.
  cleanupAsset(oldPublicId);

  return mapNewsRow(result.rows[0]);
};

/**
 * Submit a draft for review. Moves status draft → pending.
 */
export const submitNews = async (
  userId: string,
  newsId: string,
): Promise<News> => {
  const existing = await getNewsById(newsId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only submit your own articles.', 403);
  }
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected articles can be submitted for review.',
      409,
    );
  }

  const result = await query(
    `UPDATE news
        SET status = 'pending',
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [newsId],
  );
  return mapNewsRow(result.rows[0]);
};

/**
 * Delete an article. Only the owner can delete it, and only while it's
 * still a draft or rejected. Pending and published articles are
 * immutable from the admin's side.
 *
 * The Cloudinary asset referenced by `imagePublicId` is destroyed
 * after the row is gone. See `cleanupAsset`.
 */
export const deleteNews = async (
  userId: string,
  newsId: string,
): Promise<void> => {
  const existing = await getNewsById(newsId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only delete your own articles.', 403);
  }
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected articles can be deleted.',
      409,
    );
  }

  await query('DELETE FROM news WHERE id = $1', [newsId]);

  // After the row is gone, drop the Cloudinary asset it referenced.
  // Order matters: a Cloudinary failure leaks one file; the reverse
  // order (asset first, row second) would risk a row pointing at a
  // destroyed asset.
  cleanupAsset(existing.imagePublicId);
};

// ─── Super admin review ──────────────────────────────────────────────────────

/**
 * Approve a pending article. Moves it to published, stamps published_at
 * (first time only), records the reviewer.
 *
 * If the article is marked featured, the currently-featured published
 * article is unfeatured in the same transaction — the partial unique
 * index would otherwise reject the update.
 */
export const approveNews = async (
  reviewerId: string,
  reviewerRole: Role,
  newsId: string,
  reviewNote?: string | null,
): Promise<News> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can approve articles.', 403);
  }

  const existing = await getNewsById(newsId);
  if (existing.status !== 'pending') {
    throw new AppError('Only pending articles can be approved.', 409);
  }

  return withTransaction(async (run) => {
    if (existing.isFeatured) {
      await clearFeaturedPublished(run, newsId);
    }

    const result = await run(
      `UPDATE news
          SET status = 'published',
              published_at = COALESCE(published_at, NOW()),
              reviewed_by = $1,
              reviewed_at = NOW(),
              review_note = $2,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [reviewerId, reviewNote ?? null, newsId],
    );

    return mapNewsRow(result.rows[0]);
  });
};

/**
 * Reject a pending article. Moves it to rejected; nothing is published.
 * The note is required by the validator, so it's always present here.
 */
export const rejectNews = async (
  reviewerId: string,
  reviewerRole: Role,
  newsId: string,
  reviewNote: string,
): Promise<News> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can reject articles.', 403);
  }

  const existing = await getNewsById(newsId);
  if (existing.status !== 'pending') {
    throw new AppError('Only pending articles can be rejected.', 409);
  }

  const result = await query(
    `UPDATE news
        SET status = 'rejected',
            reviewed_by = $1,
            reviewed_at = NOW(),
            review_note = $2,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [reviewerId, reviewNote, newsId],
  );
  return mapNewsRow(result.rows[0]);
};

// ─── Featured toggle (super admin) ───────────────────────────────────────────

/**
 * Set the featured flag on a published article. Enforces the "at most
 * one featured published article" rule inside a transaction.
 *
 * This is deliberately a separate endpoint from updateNews so the
 * super admin can promote/demote an already-published article without
 * editing its content.
 */
export const setFeaturedNews = async (
  reviewerId: string,
  reviewerRole: Role,
  newsId: string,
  isFeatured: boolean,
): Promise<News> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError(
      'Only super admins can change the featured article.',
      403,
    );
  }

  const existing = await getNewsById(newsId);
  if (existing.status !== 'published') {
    throw new AppError('Only published articles can be featured.', 409);
  }

  if (!isFeatured) {
    // Unfeaturing is trivially safe — no other row is affected.
    const result = await query(
      `UPDATE news
          SET is_featured = false,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [newsId],
    );
    return mapNewsRow(result.rows[0]);
  }

  return withTransaction(async (run) => {
    await clearFeaturedPublished(run, newsId);

    const result = await run(
      `UPDATE news
          SET is_featured = true,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [newsId],
    );

    return mapNewsRow(result.rows[0]);
  });
};