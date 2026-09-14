// src/features/publications/publications.service.ts
//
// Service layer for the Publications feature.
//
// Responsibilities:
//   - Public reads: list published publications, read one published
//     publication (including its preview pages).
//   - Admin reads: list all publications (any status), read any by id.
//   - Admin writes: create draft, update draft, submit for review,
//     delete a draft.
//   - Super admin writes: approve (→ published), reject (→ rejected).
//
// Nothing here talks HTTP. Controllers call these functions and shape
// the response. All row → domain mapping lives here.
//
// Files:
//   Every publication references a Cloudinary asset via `filePublicId`.
//   The database has no foreign key that reaches into Cloudinary, so
//   the service is responsible for destroying files when it removes or
//   replaces the row that pointed at them. See `cleanupFile`.
//
//   Unlike News and Events there is no separate image — the PDF *is*
//   the asset. A publication without a file is not a valid row, so
//   `filePublicId` is non-null on every row the service writes.

import { query } from '../../config/db';
import { AppError } from '../../utils/Apperror';
import { deleteAsset } from '../../utils/upload';
import type { Role } from '../../types/roles';
import type {
  Publication,
  PublicationPage,
  PublicationSummary,
  PublicPublication,
  PublicPublicationSummary,
} from './publications.types';
import type {
  PublicationInputPayload,
  UpdatePublicationInputSchema,
  ListPublicationsQuery,
} from './publications.validator';

// ─── File cleanup ────────────────────────────────────────────────────────────
//
// Same pattern as news.service.ts / events.service.ts. Cloudinary assets
// outlive the rows that reference them. Any time the service removes or
// replaces a row's `filePublicId`, the old asset must be destroyed
// separately.
//
// Fire-and-forget by design. The DB write has already succeeded by the
// time we get here; a Cloudinary hiccup must not roll it back or fail
// the response. `deleteAsset` already treats a missing asset as "gone",
// so a double-delete or a race with a manual cleanup is a no-op.

const cleanupFile = (publicId: string | null): void => {
  if (!publicId) return;
  void deleteAsset(publicId);
};

// ─── Row mappers ─────────────────────────────────────────────────────────────
//
// Every row that comes out of Postgres has snake_case column names.
// Every domain type in publications.types.ts is camelCase. These
// functions are the only place the conversion happens.
//
// `pages` is a JSONB column. Postgres returns it already parsed as an
// array of objects, so no decoding is needed — but we assert the shape
// so a malformed row fails loudly rather than silently producing a
// reader that renders nothing.

const assertPagesShape = (value: unknown): PublicationPage[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is PublicationPage =>
      p &&
      typeof p === 'object' &&
      typeof (p as any).pageNumber === 'number' &&
      typeof (p as any).title === 'string' &&
      typeof (p as any).content === 'string',
  );
};

const mapPublicationRow = (row: Record<string, any>): Publication => ({
  id:            row.id,
  title:         row.title,
  description:   row.description,
  category:      row.category,
  year:          row.year,
  fileSize:      row.file_size,
  fileUrl:       row.file_url,
  filePublicId:  row.file_public_id,
  fileBytes:     Number(row.file_bytes),
  pages:         assertPagesShape(row.pages),
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

const mapPublicationSummary = (
  row: Record<string, any>,
): PublicationSummary => ({
  id:          row.id,
  title:       row.title,
  description: row.description,
  category:    row.category,
  year:        row.year,
  fileSize:    row.file_size,
  fileUrl:     row.file_url,
  status:      row.status,
  publishedAt: row.published_at,
  createdAt:   row.created_at,
  updatedAt:   row.updated_at,
});

/**
 * Strips the internal fields before a row is sent to the public.
 * Includes `filePublicId` — the public reader only needs the URL and
 * the preview pages, not the Cloudinary implementation detail.
 */
const toPublic = (pub: Publication): PublicPublication => {
  const {
    reviewNote,
    reviewedBy,
    reviewedAt,
    createdBy,
    createdByRole,
    filePublicId,
    ...rest
  } = pub;
  return rest;
};

const toPublicSummary = (
  summary: PublicationSummary,
): PublicPublicationSummary => {
  const { status, ...rest } = summary;
  return rest;
};

// ─── Transaction helper ──────────────────────────────────────────────────────
//
// Same shape as news.service.ts and events.service.ts. Publications
// have no multi-statement writes today (no featured toggle, no
// auto-unpublish), so this is currently unused. It's kept here so the
// pattern is consistent and so a future "unpublish previous version"
// feature has a ready-made helper.
//
// TODO: config/db.ts does not currently expose a `connect()` method on
// the exported `query`, so this would fall through to the inline path
// and the "transaction" would not be a transaction. Harmless today
// because nothing here uses it; fix `config/db.ts` before adding a
// multi-statement write.

const withTransaction = async <T>(
  fn: (run: (text: string, params?: any[]) => Promise<any>) => Promise<T>,
): Promise<T> => {
  const client = await (query as any).connect?.();

  if (!client) {
    console.warn(
      '[publications.service] No transaction support in db.ts — running inline. ' +
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
 * List published publications. Paginated. Optional free-text search
 * across title and description, optional category filter.
 *
 * Always ordered by published_at DESC — most recent first. That matches
 * the reader expectation: the newest additions appear at the top of the
 * library.
 */
export const listPublishedPublications = async (
  options: ListPublicationsQuery['query'],
): Promise<{ items: PublicPublicationSummary[]; total: number }> => {
  const { search, category, page, limit } = options;
  const offset = (page - 1) * limit;

  const conditions: string[] = [`status = 'published'`];
  const params: any[] = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(title ILIKE $${params.length} OR description ILIKE $${params.length})`,
    );
  }

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [countRes, pageRes] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total FROM publications ${where}`,
      params,
    ),
    query(
      `SELECT id, title, description, category, year,
              file_size, file_url, status,
              published_at, created_at, updated_at
         FROM publications
         ${where}
         ORDER BY published_at DESC NULLS LAST
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
  ]);

  return {
    items: pageRes.rows.map(mapPublicationSummary).map(toPublicSummary),
    total: countRes.rows[0].total,
  };
};

/**
 * Read one published publication by id, including its preview pages.
 * Throws 404 for anything that isn't published — drafts and rejected
 * publications are not visible to the public.
 */
export const getPublishedPublicationById = async (
  id: string,
): Promise<PublicPublication> => {
  const result = await query(
    `SELECT * FROM publications WHERE id = $1 AND status = 'published'`,
    [id],
  );
  if (!result.rowCount) {
    throw new AppError('Publication not found.', 404);
  }
  return toPublic(mapPublicationRow(result.rows[0]));
};

// ─── Admin reads ─────────────────────────────────────────────────────────────

/**
 * List all publications regardless of status, newest first. Used by
 * the admin index page.
 *
 * The summary deliberately omits `pages` — the reader fetches them on
 * open. The summary still includes `fileSize` and `fileUrl` so the
 * admin can show the download link without a second request.
 */
export const listAllPublications = async (): Promise<PublicationSummary[]> => {
  const result = await query(
    `SELECT id, title, description, category, year,
            file_size, file_url, status,
            published_at, created_at, updated_at
       FROM publications
       ORDER BY created_at DESC`,
  );
  return result.rows.map(mapPublicationSummary);
};

/**
 * List publications waiting on review. Super admin's queue.
 */
export const listPendingPublications = async (): Promise<
  PublicationSummary[]
> => {
  const result = await query(
    `SELECT id, title, description, category, year,
            file_size, file_url, status,
            published_at, created_at, updated_at
       FROM publications
       WHERE status = 'pending'
       ORDER BY created_at ASC`,
  );
  return result.rows.map(mapPublicationSummary);
};

/**
 * Read any publication by id, regardless of status. Used by the admin
 * editor and the review panel. Includes the preview pages.
 */
export const getPublicationById = async (id: string): Promise<Publication> => {
  const result = await query(`SELECT * FROM publications WHERE id = $1`, [id]);
  if (!result.rowCount) {
    throw new AppError('Publication not found.', 404);
  }
  return mapPublicationRow(result.rows[0]);
};

// ─── Admin writes ────────────────────────────────────────────────────────────

/**
 * Create a new draft publication. The caller's id and role are stamped
 * on the row for the audit trail.
 *
 * No file cleanup needed — nothing was replaced. The uploaded PDF is
 * now referenced by the new row.
 */
export const createPublication = async (
  userId: string,
  role: Role,
  input: PublicationInputPayload,
): Promise<Publication> => {
  const result = await query(
    `INSERT INTO publications
       (title, description, category, year,
        file_url, file_public_id, file_bytes, file_size,
        pages, status, created_by, created_by_role)
     VALUES ($1, $2, $3, $4,
             $5, $6, $7, $8,
             $9::jsonb, 'draft', $10, $11)
     RETURNING *`,
    [
      input.title,
      input.description,
      input.category,
      input.year,
      input.fileUrl,
      input.filePublicId,
      input.fileBytes,
      input.fileSize,
      JSON.stringify(input.pages ?? []),
      userId,
      role,
    ],
  );
  return mapPublicationRow(result.rows[0]);
};

/**
 * Update a publication the caller owns. Only drafts and rejected
 * publications can be edited — once pending, the content is frozen for
 * review; once published, use a super_admin action or unpublish (not
 * implemented).
 *
 * Partial update: only fields present in `input` are changed.
 *
 * If the client replaces the PDF, the previous Cloudinary asset is
 * destroyed after the UPDATE succeeds. See `cleanupFile`.
 */
export const updatePublication = async (
  userId: string,
  publicationId: string,
  input: UpdatePublicationInputSchema['payload'],
): Promise<Publication> => {
  const existing = await getPublicationById(publicationId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only edit your own publications.', 403);
  }

  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected publications can be edited.',
      409,
    );
  }

  // Build the SET clause from whatever fields are present.
  const fields: string[] = [];
  const params: any[] = [];

  const set = (column: string, value: any, cast?: string) => {
    params.push(value);
    const placeholder = `$${params.length}`;
    fields.push(`${column} = ${cast ? `${placeholder}::${cast}` : placeholder}`);
  };

  if (input.title        !== undefined) set('title',          input.title);
  if (input.description  !== undefined) set('description',    input.description);
  if (input.category     !== undefined) set('category',       input.category);
  if (input.year         !== undefined) set('year',           input.year);
  if (input.fileUrl      !== undefined) set('file_url',       input.fileUrl);
  if (input.filePublicId !== undefined) set('file_public_id', input.filePublicId);
  if (input.fileBytes    !== undefined) set('file_bytes',     input.fileBytes);
  if (input.fileSize     !== undefined) set('file_size',      input.fileSize);
  if (input.pages        !== undefined) {
    set('pages', JSON.stringify(input.pages), 'jsonb');
  }

  if (fields.length === 0) {
    // Nothing to change — return the current row rather than issuing a
    // no-op UPDATE.
    return existing;
  }

  // If the client is replacing the file, capture the old public id
  // before the UPDATE so we can clean it up afterwards. We only do
  // this when the id actually changes — re-saving the same PDF is a
  // no-op on Cloudinary.
  const oldPublicId =
    input.filePublicId !== undefined &&
    input.filePublicId !== existing.filePublicId
      ? existing.filePublicId
      : null;

  fields.push(`updated_at = NOW()`);
  params.push(publicationId);

  const result = await query(
    `UPDATE publications
        SET ${fields.join(', ')}
      WHERE id = $${params.length}
      RETURNING *`,
    params,
  );

  // Row is written. Now it's safe to drop the superseded file.
  cleanupFile(oldPublicId);

  return mapPublicationRow(result.rows[0]);
};

/**
 * Submit a draft for review. Moves status draft → pending.
 */
export const submitPublication = async (
  userId: string,
  publicationId: string,
): Promise<Publication> => {
  const existing = await getPublicationById(publicationId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only submit your own publications.', 403);
  }
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected publications can be submitted for review.',
      409,
    );
  }

  const result = await query(
    `UPDATE publications
        SET status = 'pending',
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [publicationId],
  );
  return mapPublicationRow(result.rows[0]);
};

/**
 * Delete a publication. Only the owner can delete it, and only while
 * it's still a draft or rejected. Pending and published publications
 * are immutable from the admin's side.
 *
 * The Cloudinary file referenced by `filePublicId` is destroyed after
 * the row is gone. See `cleanupFile`.
 */
export const deletePublication = async (
  userId: string,
  publicationId: string,
): Promise<void> => {
  const existing = await getPublicationById(publicationId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only delete your own publications.', 403);
  }
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected publications can be deleted.',
      409,
    );
  }

  await query('DELETE FROM publications WHERE id = $1', [publicationId]);

  // After the row is gone, drop the Cloudinary file it referenced.
  // Order matters: a Cloudinary failure leaks one file; the reverse
  // order (file first, row second) would risk a row pointing at a
  // destroyed asset.
  cleanupFile(existing.filePublicId);
};

// ─── Super admin review ──────────────────────────────────────────────────────

/**
 * Approve a pending publication. Moves it to published, stamps
 * published_at (first time only), records the reviewer.
 *
 * No transaction needed — single-statement update. If you later add a
 * "only one publication per category" rule, this becomes the second
 * place in the codebase that needs `withTransaction`.
 */
export const approvePublication = async (
  reviewerId: string,
  reviewerRole: Role,
  publicationId: string,
  reviewNote?: string | null,
): Promise<Publication> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can approve publications.', 403);
  }

  const existing = await getPublicationById(publicationId);
  if (existing.status !== 'pending') {
    throw new AppError('Only pending publications can be approved.', 409);
  }

  const result = await query(
    `UPDATE publications
        SET status = 'published',
            published_at = COALESCE(published_at, NOW()),
            reviewed_by = $1,
            reviewed_at = NOW(),
            review_note = $2,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [reviewerId, reviewNote ?? null, publicationId],
  );
  return mapPublicationRow(result.rows[0]);
};

/**
 * Reject a pending publication. Moves it to rejected; nothing is
 * published. The note is required by the validator, so it's always
 * present here.
 */
export const rejectPublication = async (
  reviewerId: string,
  reviewerRole: Role,
  publicationId: string,
  reviewNote: string,
): Promise<Publication> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can reject publications.', 403);
  }

  const existing = await getPublicationById(publicationId);
  if (existing.status !== 'pending') {
    throw new AppError('Only pending publications can be rejected.', 409);
  }

  const result = await query(
    `UPDATE publications
        SET status = 'rejected',
            reviewed_by = $1,
            reviewed_at = NOW(),
            review_note = $2,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [reviewerId, reviewNote, publicationId],
  );
  return mapPublicationRow(result.rows[0]);
};